import "server-only";
import { createHash } from "node:crypto";
import { adminClient } from "@/lib/supabase/admin";
import { draftBusinessAnswer, type RecipientAgent } from "@/lib/agents/respond";
import { researchWeb } from "@/lib/research";
import { hit } from "@/lib/limits";
import { htmlToText } from "./extract";
import { safeFetch } from "./fetch";
import { citation } from "./learn";
import { searchIndex } from "./site-index";
import { clipPage, isPublicDomain, pageTitle, shortUrl, siteDomain } from "./site";
import { businessSources } from "./sources";

/**
 * If it's on the business's website, its agent answers: the team is only
 * asked when the website doesn't say. Not found in what it has read, the
 * agent looks on the business's OWN website:
 *   1. its address index (the pages the site lists) → reads the matching pages;
 *   2. otherwise a web search limited to the business's domain → reads the
 *      pages that search found, itself.
 * Either way it answers from the page it read, with where it came from, and
 * keeps the page, so the next person gets the answer at once.
 * Only for a live website, and the business can turn it off.
 */

const KEEP_FRESH_DAYS = 7;
const MAX_ON_DEMAND = 300;
/** A page read because someone asked: the beginning and the end of a long one. */
const ON_DEMAND_TEXT = 16_000;

/** Reads one page of the business's site and keeps it with its knowledge. True when it's there to answer from. */
async function readAndKeep(agentId: string, url: string): Promise<boolean> {
  const db = adminClient();
  const { data: have } = await db.from("business_sources").select("origin, last_read_at").eq("agent_id", agentId).eq("url", url).maybeSingle();
  // The scan or the business's own link already keeps this page.
  if (have && have.origin !== "on_demand") return true;
  // Read on demand in the last week: still good.
  if (have?.last_read_at && Date.parse(have.last_read_at) > Date.now() - KEEP_FRESH_DAYS * 86_400_000) return true;
  try {
    const page = await safeFetch(url);
    if (!page.contentType.includes("html")) return false;
    const html = page.body.toString("utf8");
    const content = clipPage(htmlToText(html).replace(/\n{3,}/g, "\n\n").trim(), ON_DEMAND_TEXT);
    if (content.length < 40) return false;
    await db.from("business_sources").upsert(
      {
        agent_id: agentId,
        url,
        origin: "on_demand",
        visibility: "public",
        status: "ok",
        kind: "page",
        content,
        title: (pageTitle(html) ?? shortUrl(url)).slice(0, 200),
        content_hash: createHash("sha256").update(content).digest("hex").slice(0, 32),
        error: null,
        last_read_at: new Date().toISOString(),
      },
      { onConflict: "agent_id,url" },
    );
    return true;
  } catch {
    return false;
  }
}

/** Keeps the on-demand pages to the most recently read few hundred. */
async function trim(agentId: string) {
  const db = adminClient();
  const { data } = await db.from("business_sources").select("id").eq("agent_id", agentId).eq("origin", "on_demand").order("last_read_at", { ascending: false }).range(MAX_ON_DEMAND, MAX_ON_DEMAND + 200);
  if (data?.length) await db.from("business_sources").delete().in("id", data.map((r) => r.id));
}

export async function lookUpOnSite(
  agent: Pick<RecipientAgent, "id" | "display_name" | "handle" | "business_info">,
  question: string,
  audience: "public" | "customers",
): Promise<{ answer: string; needs_team: boolean } | null> {
  if ((agent.business_info as { lookup?: boolean } | null)?.lookup === false) return null;
  const db = adminClient();
  const { data: site } = await db.from("business_sites").select("domain, live_at").eq("agent_id", agent.id).maybeSingle();
  if (!site?.live_at) return null;
  if (!(await hit("siteLookupsPerAgent", agent.id)).allowed) return null;

  /** Reads these pages and answers from them (given whole, with the rest of what the agent knows). */
  const answerFrom = async (urls: string[]) => {
    const read = (await Promise.all(urls.map(async (url) => ((await readAndKeep(agent.id, url)) ? url : null)))).filter((u): u is string => u !== null);
    if (!read.length) return null;
    void trim(agent.id);
    const reply = await draftBusinessAnswer(agent, question, await businessSources(agent.id), audience, read);
    return reply.needs_team ? null : reply;
  };

  // 1. The address index: read the pages whose address matches the question.
  const hits = await searchIndex(agent.id, question);
  const fromIndex = hits.length ? await answerFrom(hits.slice(0, 2).map((h) => h.url)) : null;
  if (fromIndex) return fromIndex;

  // 2. A web search of the business's own website only (older pages, or a question in another language).
  if (!isPublicDomain(site.domain)) return null;
  const found = await researchWeb({ question, allowedDomains: [site.domain] });
  const own = found.sources.filter((s) => {
    try {
      return siteDomain(new URL(s.url).hostname) === site.domain;
    } catch {
      return false;
    }
  });
  if (!own.length) return null;
  // The pages the search found are read by the agent itself: it answers from the page, not from a search snippet.
  const fromSearch = await answerFrom(own.slice(0, 2).map((s) => s.url));
  if (fromSearch) return fromSearch;
  // Unconfirmed numbers or nothing found: the team answers instead.
  if (found.status !== "answered") return null;
  return { answer: `${found.text}\n\n${citation(own[0].url, found.retrievedAt)}`, needs_team: false };
}
