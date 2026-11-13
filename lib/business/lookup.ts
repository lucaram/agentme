import "server-only";
import { createHash } from "node:crypto";
import { adminClient } from "@/lib/supabase/admin";
import { draftBusinessAnswer, type RecipientAgent } from "@/lib/agents/respond";
import { findOnWeb, pickPages, recallLookup, rememberLookup, searchWords, type FoundPage } from "@/lib/research";
import { anchorsOnPage, searchAddress, searchCandidates } from "./site-search";
import { hit } from "@/lib/limits";
import { htmlToText } from "./extract";
import { safeFetch } from "./fetch";
import { searchIndex } from "./site-index";
import { clipPage, isPublicDomain, pageTitle, shortUrl, siteDomain } from "./site";
import { businessSources } from "./sources";

/**
 * If it's on the business's website, its agent answers: the team is only
 * asked when the website doesn't say. Not found in what it has read, the
 * agent looks on the business's OWN website:
 *   1. its address index (the pages the site lists);
 *   2. otherwise a search limited to the business's domain, which only finds
 *      pages (a small model, no answer).
 * Either way the candidates are narrowed to the two most likely, the app
 * reads those pages itself, and ONE call answers from them, with where it
 * came from. The pages are kept, and what was found (or that nothing was) is
 * remembered, so the same question doesn't cost a search every time.
 * Only for a live website, and the business can turn it off.
 */

const KEEP_FRESH_DAYS = 7;
const MAX_ON_DEMAND = 300;
/** A page read because someone asked: the beginning and the end of a long one. */
const ON_DEMAND_TEXT = 16_000;
/** Candidates shown to the picker from each step. */
const CANDIDATES = 8;

export type LookupResult = { answer: string; needs_team: boolean; step: "index" | "search" };

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

/** What the website's own search returns for these words: links that mention them (candidates only; never throws). */
async function siteSearch(template: string, words: string, siteUrl: string): Promise<FoundPage[]> {
  try {
    const address = searchAddress(template, words);
    const page = await safeFetch(address);
    if (!page.contentType.includes("html")) return [];
    // Results anywhere on the site, not only under the part that was scanned.
    return searchCandidates(anchorsOnPage(page.body.toString("utf8"), new URL(siteUrl), "/"), words, address);
  } catch {
    return [];
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
): Promise<LookupResult | null> {
  if ((agent.business_info as { lookup?: boolean } | null)?.lookup === false) return null;
  const db = adminClient();
  const { data: site } = await db.from("business_sites").select("domain, url, live_at, search_template, lang").eq("agent_id", agent.id).maybeSingle();
  if (!site?.live_at) return null;

  /** Reads these pages and answers from them (given whole, with the rest of what the agent knows). One answer call. */
  const answerFrom = async (urls: string[], step: LookupResult["step"]): Promise<LookupResult | null> => {
    const read = (await Promise.all(urls.map(async (url) => ((await readAndKeep(agent.id, url)) ? url : null)))).filter((u): u is string => u !== null);
    if (!read.length) return null;
    void trim(agent.id);
    const reply = await draftBusinessAnswer(agent, question, await businessSources(agent.id), audience, read);
    return reply.needs_team ? null : { answer: reply.answer, needs_team: false, step };
  };
  /** Pages already read for this question that didn't answer it: not offered again by a later step. */
  const tried = new Set<string>();
  /** Narrows the candidates to the two most likely, reads them and answers; remembers which pages answered. */
  const tryPages = async (found: FoundPage[], step: LookupResult["step"]): Promise<LookupResult | null> => {
    const candidates = found.filter((p) => !tried.has(p.url)).slice(0, CANDIDATES);
    if (!candidates.length) return null;
    const chosen = (await pickPages(question, candidates)).map((c) => c.url);
    const reply = await answerFrom(chosen, step);
    if (reply) await rememberLookup(agent.id, question, { pages: chosen, step });
    else for (const url of chosen) tried.add(url);
    return reply;
  };

  // Asked before: the pages that answered it (no search), or nothing did (no search either, for a few hours).
  const before = await recallLookup(agent.id, question);
  if (before && "miss" in before) return null;
  if (before) {
    const again = await answerFrom(before.pages, before.step);
    if (again) return again;
  }
  if (!(await hit("siteLookupsPerAgent", agent.id)).allowed) return null;

  // The words a page about this would use, in the website's language ("review" → "recensione" on an Italian
  // site): matching by meaning, with one small call. Empty when that fails: the question's own words are used.
  const words = await searchWords(question, site.lang);

  // 1. The address index: pages whose address matches those words, or the question's own (free).
  const hits = await searchIndex(agent.id, `${words} ${question}`, CANDIDATES);
  const fromIndex = await tryPages(hits.map((h) => ({ url: h.url, title: "" })), "index");
  if (fromIndex) return fromIndex;

  // 2. The website's own search box, when it has one (free, complete, always up to date).
  if (site.search_template) {
    const fromSiteSearch = await tryPages(await siteSearch(site.search_template, words || question, site.url), "search");
    if (fromSiteSearch) return fromSiteSearch;
  }

  // 3. A web search of the business's own website only (older pages, sites without a usable search of their own).
  if (isPublicDomain(site.domain)) {
    const found = await findOnWeb({ question, allowedDomains: [site.domain] });
    // The search itself failed: not a miss to remember.
    if (found === null) return null;
    const own = found.filter((p) => {
      try {
        return siteDomain(new URL(p.url).hostname) === site.domain;
      } catch {
        return false;
      }
    });
    const fromSearch = await tryPages(own, "search");
    if (fromSearch) return fromSearch;
  }

  // The website doesn't say: remembered, so the next few askers don't each cost a search. The team answers.
  await rememberLookup(agent.id, question, { miss: true });
  return null;
}
