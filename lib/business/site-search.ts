import { candidateUrl, indexWords, scopeOf, siteDomain } from "./site";
import { terms } from "./knowledge";

/**
 * A website's own search box. Found when the site is read (a search form, or
 * the search address it declares to search engines) and used when someone
 * asks about a page the agent hasn't read: free, complete and always up to
 * date. Every site's search is different, so results are only candidates:
 * links that don't mention the words asked about are dropped, and the agent
 * still reads the page before answering. Pure (unit-tested).
 */

/** The field a search form sends its words in. */
const QUERY_FIELDS = new Set(["q", "s", "query", "search", "keyword", "keywords", "k", "term", "text", "search_query", "searchterm", "qs", "w", "cerca", "ricerca", "chiave", "suche", "buscar", "recherche"]);

const attr = (tag: string, name: string): string | null => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[1] ?? m[2] ?? m[3] ?? "").replace(/&amp;/g, "&").trim() : null;
};

/** "it-IT" → "it": the language the site says it's written in. */
export function pageLang(html: string): string | null {
  const tag = html.match(/<html\b[^>]*>/i)?.[0];
  const lang = tag ? attr(tag, "lang") : null;
  const code = lang?.toLowerCase().match(/^[a-z]{2,3}/)?.[0];
  return code ?? null;
}

/** Only the site's own search, as an address with {q} where the words go. */
function template(raw: string, base: URL): string | null {
  let url: URL;
  try {
    url = new URL(raw.replace(/\{q\}/g, "QQQQ"), base);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (siteDomain(url.hostname) !== siteDomain(base.hostname)) return null;
  const out = url.toString().replace(/QQQQ/g, "{q}");
  return out.includes("{q}") && out.length <= 500 ? out : null;
}

/**
 * The site's search address, with {q} for the words: from what it declares
 * to search engines (schema.org SearchAction), else its search form, else the
 * standard WordPress search. Null when it has none we can use.
 */
export function detectSearch(html: string, base: URL): string | null {
  // 1. Declared: "target": "https://x.com/search?q={search_term_string}" (or urlTemplate).
  if (/SearchAction/i.test(html)) {
    for (const m of html.matchAll(/"(?:target|urlTemplate)"\s*:\s*"([^"]*\{[a-z_]+\}[^"]*)"/gi)) {
      const found = template(m[1].replace(/\\\//g, "/").replace(/\{[a-z_]+\}/gi, "{q}"), base);
      if (found) return found;
    }
  }
  // 2. A search form that sends its words in the address (not a login or newsletter form).
  for (const form of html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)) {
    const open = form[0].match(/<form\b[^>]*>/i)![0];
    if ((attr(open, "method") ?? "get").toLowerCase() !== "get") continue;
    const inputs = [...form[0].matchAll(/<input\b[^>]*>/gi)].map((i) => i[0]);
    const field = inputs.find((i) => {
      const name = attr(i, "name")?.toLowerCase();
      const type = (attr(i, "type") ?? "text").toLowerCase();
      return name && (type === "search" || ((type === "text" || type === "") && QUERY_FIELDS.has(name)));
    });
    if (!field) continue;
    if (inputs.some((i) => ["password", "email"].includes((attr(i, "type") ?? "").toLowerCase()))) continue;
    let action: URL;
    try {
      action = new URL(attr(open, "action") || base.pathname, base);
    } catch {
      continue;
    }
    // Fixed fields sent along with the words (e.g. post_type=product).
    for (const i of inputs) {
      const name = attr(i, "name");
      if (name && (attr(i, "type") ?? "").toLowerCase() === "hidden") action.searchParams.set(name, attr(i, "value") ?? "");
    }
    const joiner = action.search ? "&" : "?";
    const found = template(`${action.toString()}${joiner}${encodeURIComponent(attr(field, "name")!)}={q}`, base);
    if (found) return found;
  }
  // 3. WordPress always has one.
  if (/<meta[^>]+name\s*=\s*["']generator["'][^>]*content\s*=\s*["']WordPress/i.test(html) || /\/wp-content\//i.test(html)) {
    return template(`${base.origin}/?s={q}`, base);
  }
  return null;
}

/** The address to fetch for these words. */
export function searchAddress(tpl: string, words: string): string {
  return tpl.replace(/\{q\}/g, encodeURIComponent(words.trim().slice(0, 120)));
}

export type Anchor = { url: string; title: string };

/** Links on a page to other pages of the same site, with their text (first text wins for a repeated address). */
export function anchorsOnPage(html: string, base: URL, scope = scopeOf(base)): Anchor[] {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(`<a ${m[1]}>`, "href");
    if (!href) continue;
    const url = candidateUrl(href, base, scope);
    if (!url) continue;
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim().slice(0, 160);
    if (!out.has(url) || (!out.get(url) && text)) out.set(url, text);
  }
  return [...out.entries()].map(([url, title]) => ({ url, title }));
}

/**
 * The links on a search results page that could be the page asked about: they
 * mention at least two of the words (one, when only one was asked), most
 * words first, the page's own order otherwise. Menus, footers and the
 * results' own "next page" links fall out.
 */
export function searchCandidates(anchors: readonly Anchor[], words: string, searchUrl: string, limit = 8): Anchor[] {
  const wanted = [...new Set(terms(words))];
  if (!wanted.length) return [];
  const need = Math.min(2, wanted.length);
  let searchPath = "";
  try {
    searchPath = new URL(searchUrl).pathname;
  } catch {
    // keep everything
  }
  return anchors
    .map((a, i) => {
      const have = indexWords(a.url, a.title).split(" ");
      return { a, i, score: wanted.filter((t) => have.some((w) => w.startsWith(t))).length };
    })
    .filter((x) => x.score >= need && !(searchPath && searchPath !== "/" && new URL(x.a.url).pathname === searchPath))
    .sort((x, y) => y.score - x.score || x.i - y.i)
    .slice(0, limit)
    .map((x) => x.a);
}
