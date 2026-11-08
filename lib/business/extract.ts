/**
 * Pure helpers for reading a business's own public pages: URL checks, private
 * address detection (so the server can't be pointed at internal machines), and
 * HTML-to-text. No network or server code here, so they're unit-tested.
 */

/** Web addresses written in the text ("our menu: https://…"), to add as links the agent reads. */
export function linksIn(text: string): string[] {
  return [...new Set((text.match(/https?:\/\/[^\s<>"')]+/gi) ?? []).map((u) => u.replace(/[.,;:!?]+$/, "")))];
}

/** The same address as stored for a link (normalised), or null if it isn't a valid URL. */
export function linkKey(raw: string): string | null {
  try {
    return new URL(raw.trim()).toString();
  } catch {
    return null;
  }
}

/**
 * Only plain http(s) links to a hostname, no credentials, standard ports.
 * allowLocal (development/tests only) also lets localhost use any port.
 */
export function checkUrl(raw: string, opts: { allowLocal?: boolean } = {}): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: "That doesn't look like a web address." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "Use a web address starting with https://" };
  if (url.username || url.password) return { ok: false, error: "Web addresses with a login can't be read." };
  const local = opts.allowLocal && url.hostname === "localhost";
  if (url.port && !["80", "443"].includes(url.port) && !local) return { ok: false, error: "Only standard web addresses can be read." };
  if (!url.hostname.includes(".") && url.hostname !== "localhost") return { ok: false, error: "That doesn't look like a public website." };
  return { ok: true, url };
}

/** Is this IP address on the public internet? (Loopback, private, link-local, etc. are not.) */
export function isPublicAddress(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    const [a, b] = v4.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return false; // this network, private, loopback
    if (a === 169 && b === 254) return false; // link-local (cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return false; // private
    if (a === 192 && b === 168) return false; // private
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    if (a === 192 && b === 0) return false; // IETF / test
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
    if (a >= 224) return false; // multicast and reserved
    return true;
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::" || v6 === "::1") return false;
  if (v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb")) return false; // link-local
  if (v6.startsWith("fc") || v6.startsWith("fd")) return false; // unique local
  if (v6.startsWith("ff")) return false; // multicast
  return true;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", euro: "€", pound: "£", ndash: "–", mdash: "—", hellip: "…", agrave: "à", aacute: "á", egrave: "è", eacute: "é", igrave: "ì", iacute: "í", ograve: "ò", oacute: "ó", ugrave: "ù", uacute: "ú", ccedil: "ç", ntilde: "ñ", uuml: "ü", ouml: "ö", auml: "ä", szlig: "ß" };

/** Readable text from an HTML page: no scripts/styles, block elements become lines. */
export function htmlToText(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const body = html
    .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<head[\s\S]*?<\/head>/i, " ")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer|table|ul|ol|dt|dd)>/gi, "\n")
    .replace(/<(li)[^>]*>/gi, "\n- ")
    .replace(/<\/t[dh]>/gi, " · ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
      if (code.startsWith("#x")) return String.fromCodePoint(parseInt(code.slice(2), 16));
      if (code.startsWith("#")) return String.fromCodePoint(parseInt(code.slice(1), 10));
      return ENTITIES[code.toLowerCase()] ?? m;
    });
  const lines = body
    .split("\n")
    .map((l) => l.replace(/[ \t\f\v ]+/g, " ").replace(/\s·\s*$/, "").trim())
    .filter((l) => l.length > 1);
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n");
  return title && !text.startsWith(title) ? `${title}\n${text}` : text;
}
