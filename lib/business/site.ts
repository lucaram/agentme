/**
 * "Paste your website": pure helpers for reading a business's whole site
 * (which pages to read, in what order, what robots.txt allows), filling in
 * sign-up from the homepage, spotting what changed, and verifying ownership.
 * No network or server code here, so it's all unit-tested.
 */
import { checkUrl, htmlToText } from "./extract";

/** Enough for a small business site; key pages (menu, prices, hours, contact) are read first. */
export const MAX_SITE_PAGES = 30;
export const MAX_PAGE_TEXT = 12_000;
export const MAX_SITE_PDFS = 3;
/** Under this much text in total, the site is probably built in the browser (little to read). */
export const THIN_SITE_CHARS = 300;

export const siteDomain = (host: string) => host.toLowerCase().replace(/^www\./, "");

/** "trattoria.co.uk", "www.trattoria.co.uk/", "https://…": a website address the agent can read. */
export function normaliseSite(raw: string, opts: { allowLocal?: boolean } = {}): { ok: true; url: URL; domain: string } | { ok: false; error: string } {
  const typed = raw.trim();
  if (!typed) return { ok: false, error: "Type your website address." };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`;
  const check = checkUrl(withScheme, opts);
  if (!check.ok) return { ok: false, error: check.error === "That doesn't look like a web address." ? "That doesn't look like a website address." : check.error };
  const url = check.url;
  url.hash = "";
  url.search = "";
  return { ok: true, url, domain: siteDomain(url.hostname) };
}

/** The part of the site to read: the folder of the address given ("/" for a normal website). */
export function scopeOf(base: URL): string {
  return base.pathname.endsWith("/") ? base.pathname : base.pathname.slice(0, base.pathname.lastIndexOf("/") + 1) || "/";
}

const SKIP =
  /\/(cart|basket|checkout|login|log-in|signin|sign-in|signup|sign-up|register|account|my-account|wp-admin|wp-login(\.php)?|admin|privacy(-policy)?|cookies?(-policy)?|terms([-_]and[-_]conditions)?|legal|gdpr|feed|rss|tag|tags|author|search|cdn-cgi)(\/|$|\.)/i;
const ASSET = /\.(css|js|mjs|json|xml|txt|ico|svg|png|jpe?g|gif|webp|avif|bmp|tiff?|mp4|mov|webm|mp3|wav|ogg|zip|gz|rar|woff2?|ttf|otf|eot|map|docx?|xlsx?|pptx?)$/i;

/** A link worth reading: same website, inside the part given, not a cart/login/legal page or a file we can't read. */
export function candidateUrl(href: string, base: URL, scope = scopeOf(base)): string | null {
  const raw = href.trim();
  if (!raw || /^(mailto|tel|javascript|data|sms|whatsapp):/i.test(raw) || raw.startsWith("#")) return null;
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (siteDomain(url.hostname) !== siteDomain(base.hostname)) return null;
  if (!url.pathname.startsWith(scope)) return null;
  if (ASSET.test(url.pathname) || SKIP.test(url.pathname)) return null;
  url.hash = "";
  url.search = "";
  return url.toString();
}

const HREF = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

/** Links on a page to other pages of the same site (in page order, no repeats). */
export function linksOnPage(html: string, base: URL, scope = scopeOf(base)): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(HREF)) {
    const href = decodeEntities(m[1] ?? m[2] ?? m[3] ?? "");
    const url = candidateUrl(href, base, scope);
    if (url) out.add(url);
  }
  return [...out];
}

/** Page addresses listed in a sitemap.xml (or the nested sitemaps of a sitemap index). */
export function sitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decodeEntities(m[1]));
}

export type RobotsRules = { allow: string[]; disallow: string[]; sitemaps: string[] };

/** What robots.txt says to "*" (or to us). Our own group wins over "*". */
export function robotsRules(txt: string): RobotsRules {
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  const sitemaps: string[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const [, field, value] = m;
    const key = field.toLowerCase();
    if (key === "sitemap") {
      sitemaps.push(value.trim());
      continue;
    }
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.trim().toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow") current.allow.push(value.trim());
    if (key === "disallow") current.disallow.push(value.trim());
  }
  const ours = groups.find((g) => g.agents.some((a) => a.includes("agentme"))) ?? groups.find((g) => g.agents.includes("*"));
  return { allow: ours?.allow.filter(Boolean) ?? [], disallow: ours?.disallow.filter(Boolean) ?? [], sitemaps };
}

const ruleRegex = (rule: string) => new RegExp(`^${rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$")}`);

/** May this path be read? The longest matching rule wins; Allow wins a tie. */
export function robotsAllows(rules: RobotsRules, path: string): boolean {
  let best: { length: number; allow: boolean } | null = null;
  for (const [list, allow] of [[rules.disallow, false], [rules.allow, true]] as const) {
    for (const rule of list) {
      if (!ruleRegex(rule).test(path)) continue;
      if (!best || rule.length > best.length || (rule.length === best.length && allow)) best = { length: rule.length, allow };
    }
  }
  return best ? best.allow : true;
}

/** Pages customers ask about most, read first. */
const KEY_PAGE =
  /(menu|price|prices|pricing|tariff|rates|rooms|hours|opening|contact|find-us|location|directions|visit|about|faq|faqs|help|services|treatments|book|booking|reserv|delivery|shipping|returns|shop|products|collection|catalog|events|classes|timetable|team|allergen)/i;

/** The homepage first, then the pages customers ask about, then the rest (shallow first). */
export function rankUrls(urls: string[], home: string): string[] {
  const seen = new Set<string>();
  const unique = [home, ...urls].filter((u) => (seen.has(u) ? false : (seen.add(u), true)));
  const depth = (u: string) => new URL(u).pathname.split("/").filter(Boolean).length;
  return unique
    .map((u, i) => ({ u, i, key: u === home ? 0 : KEY_PAGE.test(new URL(u).pathname) ? 1 : 2 }))
    .sort((a, b) => a.key - b.key || depth(a.u) - depth(b.u) || a.i - b.i)
    .map((x) => x.u);
}

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code.startsWith("#x")) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(parseInt(code.slice(1), 10));
    return ENTITY[code.toLowerCase()] ?? m;
  });
}

/** <meta name|property="…" content="…"> in either attribute order. */
export function metaContent(html: string, name: string): string | null {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const a = html.match(new RegExp(`<meta[^>]+(?:name|property)\\s*=\\s*["']${n}["'][^>]*content\\s*=\\s*["']([^"']*)["']`, "i"));
  const b = html.match(new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*(?:name|property)\\s*=\\s*["']${n}["']`, "i"));
  const value = (a?.[1] ?? b?.[1])?.trim();
  return value ? decodeEntities(value) : null;
}

export function pageTitle(html: string): string | null {
  const title = metaContent(html, "og:title") ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const clean = title ? decodeEntities(title).replace(/\s+/g, " ").trim() : "";
  return clean ? clean.slice(0, 120) : null;
}

/** "Trattoria da Luca | Italian restaurant in Camden" → "Trattoria da Luca". */
function nameFromTitle(title: string): string {
  const parts = title.split(/\s+[|·•–—-]\s+|:\s+/).map((p) => p.trim()).filter(Boolean);
  const home = /^(home|homepage|welcome|index)$/i;
  return (parts.find((p) => !home.test(p)) ?? title).trim();
}

/** Whole words (accented letters count as letters, so "café" matches). */
const anyWord = (list: string) => new RegExp(`(?:^|[^\\p{L}])(?:${list})(?=$|[^\\p{L}])`, "iu");

/** Picture for the business, from what it does (one of the business pictures). */
const CATEGORY: [RegExp, string][] = [
  [anyWord("pizza|pizzeria"), "🍕"],
  [anyWord("restaurant|trattoria|osteria|bistro|kitchen|dining|ristorante|food|eatery|brasserie|tapas|sushi"), "🍝"],
  [anyWord("caf[eéè]|caff[eéè]|coffee|espresso|bakery|patisserie|tea ?room|cakes?"), "☕"],
  [anyWord("hair|salon|barbers?|beauty|nails?|spa"), "💇"],
  [anyWord("gym|fitness|yoga|pilates|personal trainer|crossfit|boxing"), "🏋️"],
  [anyWord("clinic|dental|dentist|doctor|physio|physiotherapy|health|pharmacy|vets?|veterinary|osteopath"), "🩺"],
  [anyWord("plumbers?|plumbing|electricians?|builders?|repairs?|handyman|garage|mechanics?|locksmith|joinery"), "🛠️"],
  [anyWord("art|gallery|studio|design|photography|photographer|tattoo|crafts?"), "🎨"],
  [anyWord("shop|store|boutique|books?|bookshop|fashion|clothing|gifts?|florist|market"), "🛍️"],
];
export function avatarFor(text: string): string {
  return CATEGORY.find(([re]) => re.test(text))?.[1] ?? "🏪";
}

/** "trattoria-camden.co.uk" → "trattoria_camden" (an @address suggestion: 3–20 letters, digits, underscores). */
export function handleFromDomain(domain: string): string {
  const stem = siteDomain(domain).split(".")[0] ?? "";
  const handle = stem.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20).replace(/_+$/, "");
  return handle.length >= 3 ? handle : "";
}

export type SitePreview = { name: string; description: string; handle: string; avatar: string; domain: string };

/** Sign-up fills itself in from the homepage: name, a short description, an @address and a picture. */
export function homePreview(html: string, url: URL): SitePreview {
  const title = pageTitle(html) ?? "";
  const name = (metaContent(html, "og:site_name") ?? nameFromTitle(title)).slice(0, 40).trim();
  const firstLine = htmlToText(html)
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length >= 40 && !l.startsWith("- ") && l !== title);
  const description = (metaContent(html, "description") ?? metaContent(html, "og:description") ?? firstLine ?? "").slice(0, 500).trim();
  const domain = siteDomain(url.hostname);
  return { name, description, handle: handleFromDomain(domain), avatar: avatarFor(`${title} ${description}`), domain };
}

/** Lines that change without the business changing anything (dates, counters, cookie notices). */
const VOLATILE = /(©|copyright|all rights reserved|cookie|last updated|updated (on|at)|\b\d+\s+(minutes?|hours?|days?)\s+ago\b|\b(today|yesterday)\b|visitors?|page views?)/i;

/** What's different on a page since it was last read: lines added and removed (ignoring the noise). */
export function changedLines(before: string, after: string, cap = 40): { added: string[]; removed: string[] } {
  const clean = (text: string) =>
    text
      .split("\n")
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter((l) => l.length >= 4 && /[a-z]/i.test(l) && !VOLATILE.test(l));
  const a = new Set(clean(before));
  const b = new Set(clean(after));
  return { added: [...b].filter((l) => !a.has(l)).slice(0, cap), removed: [...a].filter((l) => !b.has(l)).slice(0, cap) };
}

/** Free email providers (an address there proves nothing about a website) and shared endings nobody owns. */
const NOT_OWNABLE = new Set(
  (
    "gmail.com googlemail.com hotmail.com hotmail.co.uk outlook.com live.com msn.com yahoo.com yahoo.co.uk ymail.com icloud.com me.com mac.com aol.com " +
    "proton.me protonmail.com pm.me gmx.com gmx.de mail.com yandex.com zoho.com tutanota.com fastmail.com hey.com qq.com 163.com " +
    "co.uk org.uk ac.uk gov.uk me.uk com.au net.au co.nz co.za co.in co.jp com.br com.mx"
  ).split(" "),
);

/** ✓ Verified automatically when your verified email is at the website's own domain (luca@trattoria.co.uk, or a subdomain of it). */
export function verifiesByEmail(email: string | null | undefined, domain: string): boolean {
  const at = email?.toLowerCase().trim().split("@")[1];
  const site = siteDomain(domain);
  if (!at || !site.includes(".") || NOT_OWNABLE.has(site)) return false;
  return at === site || at.endsWith(`.${site}`);
}

export const VERIFY_META = "agentme-verify";
export const verifyTag = (token: string) => `<meta name="${VERIFY_META}" content="${token}">`;

/** ✓ Verified by adding our meta tag to the homepage. */
export function hasVerifyToken(html: string, token: string): boolean {
  return Boolean(token) && metaContent(html, VERIFY_META) === token;
}

/** "trattoria.co.uk/menu" for a citation or a list. */
export function shortUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const path = url.pathname.replace(/\/(index\.html?)?$/i, "").replace(/\/$/, "");
    return `${siteDomain(url.hostname)}${path}`;
  } catch {
    return raw;
  }
}

// ------------------------------------------------------------- address index (pages found, not yet read)

/** Up to this many addresses are indexed per business; pages are read only when someone asks. */
/** A domain a web search can reach (not localhost, an IP address or a port). */
export const isPublicDomain = (domain: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(domain);

export const MAX_INDEX_URLS = 50_000;
export const MAX_INDEX_SITEMAPS = 150;

/** Newest first; addresses without a date last (their order kept). */
export function newestFirst<T extends { lastmod: string | null }>(rows: T[]): T[] {
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => (b.row.lastmod ?? "").localeCompare(a.row.lastmod ?? "") || a.i - b.i)
    .map((x) => x.row);
}

/** A long page keeps its beginning and its end (where a review's verdict or a price list's notes are). */
export function clipPage(text: string, max: number): string {
  if (text.length <= max) return text;
  const tail = Math.floor(max * 0.3);
  return `${text.slice(0, max - tail - 3).trimEnd()}\n…\n${text.slice(-tail).trimStart()}`;
}

export type SitemapEntry = { loc: string; lastmod: string | null; title: string | null };

/** Each <url> (or nested <sitemap>) of a sitemap: address, last change, and a title when it's a news sitemap. */
export function sitemapEntries(xml: string): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  for (const m of xml.matchAll(/<(url|sitemap)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const body = m[2];
    const loc = body.match(/<loc>\s*([^<\s]+)\s*<\/loc>/i)?.[1];
    if (!loc) continue;
    const lastmod = body.match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i)?.[1] ?? null;
    const title = body.match(/<news:title>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/news:title>/i)?.[1]?.trim() ?? null;
    out.push({ loc: decodeEntities(loc), lastmod: lastmod && !Number.isNaN(Date.parse(lastmod)) ? new Date(lastmod).toISOString() : null, title: title ? decodeEntities(title) : null });
  }
  return out;
}

/** The words an address can be found by: its path split into words ("/recensioni/castlevania-nocturne.html" → "recensioni castlevania nocturne"), plus a title. */
export function indexWords(url: string, title?: string | null): string {
  let path = url;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    // keep the raw address
  }
  const words = `${path.replace(/\.(html?|php|aspx?)$/i, "")} ${title ?? ""}`
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .match(/[a-z0-9]{2,}/g);
  return [...new Set(words ?? [])].join(" ").slice(0, 600);
}

/**
 * The addresses that best match a question: by how many of its words they
 * contain (a word matches when the address has a word starting with it), at
 * least half of them, newest first among equals. At most `limit`.
 */
export function rankIndexHits<T extends { url: string; words: string; lastmod: string | null }>(terms: readonly string[], rows: T[], limit = 3): T[] {
  if (!terms.length) return [];
  // Half of the words, but never more than three: a long question has many words no address contains.
  const need = Math.min(3, Math.max(1, Math.ceil(terms.length / 2)));
  return rows
    .map((row) => {
      const words = row.words.split(" ");
      return { row, score: terms.filter((t) => words.some((w) => w.startsWith(t))).length };
    })
    .filter((x) => x.score >= need)
    .sort((a, b) => b.score - a.score || (b.row.lastmod ?? "").localeCompare(a.row.lastmod ?? ""))
    .slice(0, limit)
    .map((x) => x.row);
}
