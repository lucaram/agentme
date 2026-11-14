import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { safeFetch } from "./fetch";
import { terms } from "./knowledge";
import { MAX_INDEX_SITEMAPS, MAX_INDEX_URLS, candidateUrl, indexWords, newestFirst, rankIndexHits, robotsRules, scopeOf, siteDomain, sitemapEntries } from "./site";

/**
 * A business's address index: the pages its sitemaps list, stored as
 * addresses and words only. Big sites (news, shops) have far more pages than
 * the first scan reads; with the index, the agent can find the right page
 * when someone asks, and read just that one. A site with more pages than the
 * index holds keeps its newest ones (older pages are found by a site search).
 */

type Found = { url: string; lastmod: string | null; title: string | null };

const INDEX_DEADLINE_MS = 4 * 60_000;

const text = async (url: string) => {
  try {
    const f = await safeFetch(url);
    return f.body.toString("utf8");
  } catch {
    return null;
  }
};

/** (Re)builds the index from the site's sitemaps. `extra`: addresses already found by the scan. */
export async function indexSite(agentId: string, siteUrl: string, extra: string[] = []) {
  const started = new Date().toISOString();
  const base = new URL(siteUrl);
  const scope = scopeOf(base);
  const robots = await text(new URL("/robots.txt", base).toString());
  const queue = [...(robots ? robotsRules(robots).sitemaps : []), new URL("/sitemap.xml", base).toString(), ...(scope !== "/" ? [new URL(`${scope}sitemap.xml`, base).toString()] : [])];
  const tried = new Set<string>();
  const seen = new Set<string>(extra);
  let found: Found[] = [];
  // A site with many slow sitemaps: stop after a few minutes and keep what was found.
  const stopAt = Date.now() + INDEX_DEADLINE_MS;
  while (queue.length && tried.size < MAX_INDEX_SITEMAPS && Date.now() < stopAt) {
    const url = queue.shift()!;
    let own = false;
    try {
      own = siteDomain(new URL(url).hostname) === siteDomain(base.hostname);
    } catch {
      own = false;
    }
    if (tried.has(url) || !own) continue;
    tried.add(url);
    const xml = await text(url);
    if (!xml) continue;
    for (const e of sitemapEntries(xml)) {
      // Addresses are normally absolute; a relative one is relative to its sitemap.
      let loc: string;
      try {
        loc = new URL(e.loc, url).toString();
      } catch {
        continue;
      }
      // A nested sitemap (some sites generate theirs: "sitemap-autori.asp").
      if (/\.xml$/i.test(loc) || (/\.(asp|aspx|php)$/i.test(loc) && /sitemap/i.test(loc))) queue.push(loc);
      else {
        const page = candidateUrl(loc, base, scope);
        if (page && !seen.has(page)) {
          seen.add(page);
          found.push({ url: page, lastmod: e.lastmod, title: e.title });
        }
      }
    }
    // More pages than the index holds: keep the newest (memory stays bounded on very big sites).
    if (found.length > MAX_INDEX_URLS * 2) found = newestFirst(found).slice(0, MAX_INDEX_URLS);
  }
  const kept = newestFirst(found).slice(0, Math.max(0, MAX_INDEX_URLS - extra.length));
  const rows = [...extra.map((url) => ({ url, lastmod: null as string | null, title: null as string | null })), ...kept]
    .map((f) => ({ agent_id: agentId, url: f.url, words: indexWords(f.url, f.title), lastmod: f.lastmod, indexed_at: started }))
    .filter((r) => r.words);
  const db = adminClient();
  let ok = rows.length > 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await db.from("business_site_index").upsert(rows.slice(i, i + 1000), { onConflict: "agent_id,url" });
    if (error) ok = false;
  }
  // Addresses the sitemaps no longer list go (only after a complete read, so a failed one keeps the old index).
  if (ok) await db.from("business_site_index").delete().eq("agent_id", agentId).lt("indexed_at", started);
  return rows.length;
}

/** The indexed addresses that best match a question (at most `limit`). */
export async function searchIndex(agentId: string, question: string, limit = 3) {
  const wanted = [...new Set(terms(question))].slice(0, 16);
  if (!wanted.length) return [];
  // "castlevania:* | nocturne:*": any of the words, as a prefix (terms are [a-z0-9] only); best matches first.
  const query = wanted.map((t) => `${t}:*`).join(" | ");
  const { data } = await adminClient().rpc("search_site_index", { p_agent: agentId, p_query: query, p_limit: 300 });
  return rankIndexHits(wanted, data ?? [], limit);
}
