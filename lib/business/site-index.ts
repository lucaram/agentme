import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { safeFetch } from "./fetch";
import { terms } from "./knowledge";
import { MAX_INDEX_SITEMAPS, MAX_INDEX_URLS, candidateUrl, indexWords, rankIndexHits, robotsRules, scopeOf, siteDomain, sitemapEntries } from "./site";

/**
 * A business's address index: every page its sitemaps list (up to 20,000),
 * stored as addresses and words only. Big sites (news, shops) have far more
 * pages than the first scan reads; with the index, the agent can find the
 * right page when someone asks, and read just that one.
 */

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
  const base = new URL(siteUrl);
  const scope = scopeOf(base);
  const robots = await text(new URL("/robots.txt", base).toString());
  const queue = [...(robots ? robotsRules(robots).sitemaps : []), new URL("/sitemap.xml", base).toString(), ...(scope !== "/" ? [new URL(`${scope}sitemap.xml`, base).toString()] : [])];
  const tried = new Set<string>();
  const found = new Map<string, { words: string; lastmod: string | null }>();
  for (const url of extra) found.set(url, { words: indexWords(url), lastmod: null });
  while (queue.length && tried.size < MAX_INDEX_SITEMAPS && found.size < MAX_INDEX_URLS) {
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
      if (/\.xml(\.gz)?$/i.test(loc)) queue.push(loc);
      else {
        const page = candidateUrl(loc, base, scope);
        if (page && found.size < MAX_INDEX_URLS) found.set(page, { words: indexWords(page, e.title), lastmod: e.lastmod });
      }
    }
  }
  const db = adminClient();
  const rows = [...found.entries()].filter(([, v]) => v.words).map(([url, v]) => ({ agent_id: agentId, url, words: v.words, lastmod: v.lastmod }));
  for (let i = 0; i < rows.length; i += 1000) await db.from("business_site_index").upsert(rows.slice(i, i + 1000), { onConflict: "agent_id,url" });
  return rows.length;
}

/** The indexed addresses that best match a question (at most three). */
export async function searchIndex(agentId: string, question: string) {
  const wanted = [...new Set(terms(question))].slice(0, 8);
  if (!wanted.length) return [];
  // "castlevania:* | nocturne:*": any of the words, as a prefix (terms are [a-z0-9] only).
  const query = wanted.map((t) => `${t}:*`).join(" | ");
  const { data } = await adminClient().from("business_site_index").select("url, words, lastmod").eq("agent_id", agentId).textSearch("fts", query, { config: "simple" }).limit(200);
  return rankIndexHits(wanted, data ?? []);
}
