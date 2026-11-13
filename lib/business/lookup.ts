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
import { MAX_PAGE_TEXT, isPublicDomain, pageTitle, shortUrl, siteDomain } from "./site";
import { businessSources } from "./sources";

/**
 * A business agent that doesn't find the answer in what it has read looks on
 * the business's OWN website before asking the team:
 *   1. its address index (every page the site lists) → read the matching pages;
 *   2. otherwise a web search limited to the business's domain.
 * Pages read this way are kept, so the next person gets the answer at once.
 * Only for a live website, and the business can turn it off.
 */

const KEEP_FRESH_DAYS = 7;
const MAX_ON_DEMAND = 300;

/** Reads one page of the business's site and keeps it with its knowledge. */
async function readAndKeep(agentId: string, url: string): Promise<boolean> {
  const db = adminClient();
  const { data: have } = await db.from("business_sources").select("origin, last_read_at").eq("agent_id", agentId).eq("url", url).maybeSingle();
  // Already read recently (by the scan, as a link, or on demand): nothing to do.
  // The scan or the business's own link already keeps this page: it was in what the agent just answered from.
  if (have && have.origin !== "on_demand") return false;
  // Read on demand in the last week: still good (and worth answering from again).
  if (have?.last_read_at && Date.parse(have.last_read_at) > Date.now() - KEEP_FRESH_DAYS * 86_400_000) return true;
  try {
    const page = await safeFetch(url);
    if (!page.contentType.includes("html")) return false;
    const html = page.body.toString("utf8");
    const content = htmlToText(html).slice(0, MAX_PAGE_TEXT);
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

  // 1. The address index: read the pages whose address matches the question.
  const hits = await searchIndex(agent.id, question);
  const read = (await Promise.all(hits.map((h) => readAndKeep(agent.id, h.url)))).some(Boolean);
  if (read) {
    void trim(agent.id);
    const reply = await draftBusinessAnswer(agent, question, await businessSources(agent.id), audience);
    if (!reply.needs_team) return reply;
  }

  // 2. A web search of the business's own website only.
  if (!isPublicDomain(site.domain)) return null;
  const found = await researchWeb({ question, allowedDomains: [site.domain] });
  if (found.status !== "answered") return null; // unconfirmed numbers or nothing found: the team answers instead
  const own = found.sources.filter((s) => {
    try {
      return siteDomain(new URL(s.url).hostname) === site.domain;
    } catch {
      return false;
    }
  });
  if (!own.length) return null;
  // Keep those pages for next time.
  await Promise.all(own.slice(0, 2).map((s) => readAndKeep(agent.id, s.url)));
  return { answer: `${found.text}\n\n${citation(own[0].url, found.retrievedAt)}`, needs_team: false };
}
