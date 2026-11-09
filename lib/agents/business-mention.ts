/**
 * "The Everyeye website won't let me log in, who do I contact?": a business
 * named without its @handle, in a question. Your agent then offers to ask
 * that business's agent. Pure (no server code), unit-tested.
 */

const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** Question words in the languages people use most here (plus any "?"). */
const QUESTION_START =
  /^(what|when|where|who|whom|which|why|how|is|are|do|does|did|can|could|will|would|should|have|has|cosa|che|come|quando|dove|chi|quale|quali|qual|perche|ce|ci sono|posso|puoi|potete|avete|hai|sai|que|cuando|donde|quien|cual|como|puedo|tienen|quoi|quand|ou|qui|quel|quelle|comment|pourquoi|est-ce|was|wann|wo|wer|welche|wie|warum|gibt es|kann)\b/;

export function looksLikeQuestion(text: string): boolean {
  const t = fold(text).trim();
  return t.includes("?") || QUESTION_START.test(t.replace(/^[^a-z]+/, ""));
}

const STOP = new Set(
  (
    "this that there their them they with from have will would could should about your mine what when where which while than then also just only very much many some more most into over under after before " +
    "questo quella quello questi sono come dove quando quale cosa della delle dello degli nella sulla anche ancora sempre molto tutto tutti fare essere avere loro sito pagina perche " +
    "website site page email contact help login"
  ).split(" "),
);

/** Words worth looking up as a business name (lowercase, no accents, 4+ letters), at most 10. */
export function nameCandidates(text: string): string[] {
  const words = fold(text).match(/[a-z0-9]{4,}/g) ?? [];
  return [...new Set(words.filter((w) => !STOP.has(w)))].slice(0, 10);
}

type Named = { handle: string; display_name: string };

const wholeWord = (haystack: string, needle: string) => new RegExp(`(^|[^a-z0-9_])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9_])`).test(haystack);

/**
 * The business the text names: its @handle as a word ("everyeye") or its full
 * name ("Trattoria Sole"). The longest, most specific match wins.
 */
export function matchBusinessName<T extends Named>(text: string, businesses: T[]): T | null {
  const t = fold(text);
  let best: { b: T; score: number } | null = null;
  for (const b of businesses) {
    const name = fold(b.display_name).trim();
    const score = Math.max(name.length >= 4 && wholeWord(t, name) ? name.length + 20 : 0, b.handle.length >= 4 && wholeWord(t, b.handle) ? b.handle.length + 10 : 0);
    if (score && (!best || score > best.score)) best = { b, score };
  }
  return best?.b ?? null;
}
