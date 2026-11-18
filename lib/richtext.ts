/**
 * A tiny, safe subset of Markdown for agent messages: paragraphs, "- " bullet
 * lists, **bold** and [links](/settings/about) to a few of the app's own pages.
 * Parsed into plain data and rendered as React elements, never as HTML, so
 * message text can't inject markup, and no other link is ever made.
 */

export type Inline = { text: string; bold: boolean; href?: string };

/** The only pages an agent message may link to (anything else stays plain text). */
export const APP_LINKS: readonly string[] = ["/settings/about", "/settings/about/lifestyle", "/contacts", "/business"];
const LINK = /\[([^\]\n]{1,80})\]\(([^)\s]{1,100})\)/g;

/** Plain text with [label](/page) links: allowed pages become links; anything else keeps just its label. */
function withLinks(text: string, bold: boolean): Inline[] {
  const out: Inline[] = [];
  let at = 0;
  for (const m of text.matchAll(LINK)) {
    if (m.index! > at) out.push({ text: text.slice(at, m.index), bold });
    out.push(APP_LINKS.includes(m[2]) ? { text: m[1], bold, href: m[2] } : { text: m[1], bold });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), bold });
  return out;
}
export type Block =
  | { type: "paragraph"; content: Inline[] }
  | { type: "list"; items: { label: string | null; content: Inline[] }[] };

export function parseInline(text: string): Inline[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .flatMap((part) => (part.startsWith("**") && part.endsWith("**") && part.length > 4 ? withLinks(part.slice(2, -2), true) : withLinks(part, false)));
}

const BULLET = /^\s*(?:[-•*]|\d+[.)])\s+/;
/** "**Decided:** rest" or "Decided: rest" at the start of a bullet. */
const LABEL = /^\*\*([^*]{1,40}?)\s*:?\s*\*\*\s*:?\s*|^([A-Z][A-Za-z' ]{1,30}):\s+/;

export function parseRichText(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (BULLET.test(line)) {
      const body = line.replace(BULLET, "");
      const m = body.match(LABEL);
      const item = m ? { label: (m[1] ?? m[2]).trim(), content: parseInline(body.slice(m[0].length)) } : { label: null, content: parseInline(body) };
      const last = blocks.at(-1);
      if (last?.type === "list") last.items.push(item);
      else blocks.push({ type: "list", items: [item] });
    } else {
      blocks.push({ type: "paragraph", content: parseInline(line) });
    }
  }
  return blocks;
}
