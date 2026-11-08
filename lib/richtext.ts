/**
 * A tiny, safe subset of Markdown for agent messages: paragraphs, "- " bullet
 * lists and **bold**. Parsed into plain data and rendered as React elements,
 * never as HTML, so message text can't inject markup.
 */

export type Inline = { text: string; bold: boolean };
export type Block =
  | { type: "paragraph"; content: Inline[] }
  | { type: "list"; items: { label: string | null; content: Inline[] }[] };

export function parseInline(text: string): Inline[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part) => (part.startsWith("**") && part.endsWith("**") && part.length > 4 ? { text: part.slice(2, -2), bold: true } : { text: part, bold: false }));
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
