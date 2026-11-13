import { wrapUntrusted } from "@/lib/agents/prompts";
import { waysOf, waysText } from "./booking";
import type { Correction } from "./learn";

/** What a business agent knows: pure (no server code), shared by the answering code and My Business. */

type BusinessInfo = { about?: string; customers?: string; description?: string; hours?: string; faqs?: { q: string; a: string }[]; corrections?: Correction[] };
/**
 * Text the agent may answer from: a link the business added ("link"), a page
 * of its website ("site"), or the website summary the owner reviewed ("learned").
 */
export type KnowledgeSource = { url: string; visibility: string; content: string | null; last_read_at: string | null; title?: string | null; origin?: string | null };

const MAX_KNOWLEDGE = 40_000;
/** Website text sent with one question: the most relevant parts of the pages. */
const PAGE_BUDGET = 24_000;
const CHUNK = 1_200;

/**
 * What a business agent may answer from, for this audience. "customers" adds
 * the customers-only text and links (the business's contacts). The owner's own
 * words (and corrections) are one block and win; website text is another,
 * marked as untrusted data. With a question, only the most relevant parts of
 * a big website are included.
 */
export function businessKnowledge(
  agent: { display_name: string; handle: string; business_info: unknown },
  sources: KnowledgeSource[],
  audience: "public" | "customers",
  question?: string,
  /** Pages just read for this very question: included whole, before the relevant parts of the others. */
  focus: readonly string[] = [],
): { info: string; websites: string } {
  const info = (agent.business_info ?? {}) as BusinessInfo;
  const about = info.about?.trim() || [info.description, info.hours && `Opening hours: ${info.hours}`].filter(Boolean).join("\n");
  const ways = waysOf(agent.business_info);
  const corrections = (info.corrections ?? []).filter((c) => c.label && c.value);
  const own = [
    `Business: ${agent.display_name} (@${agent.handle})`,
    about,
    ways.length ? `How customers book or order (you can't do it yourself; give them these):
${waysText(ways)}` : "",
    corrections.length ? `Corrections by the owner (right even where the website says otherwise):\n${corrections.map((c) => `- ${c.label}: ${c.value}`).join("\n")}` : "",
    ...(info.faqs ?? []).map((f) => `Q: ${f.q}\nA: ${f.a}`),
    audience === "customers" && info.customers?.trim() ? `For customers:\n${info.customers.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const visible = sources.filter((s) => s.content && (s.visibility === "public" || audience === "customers"));
  const pinned = visible.filter((s) => s.origin === "learned");
  const focused = visible.filter((s) => s.origin !== "learned" && focus.includes(s.url));
  const pages = visible.filter((s) => s.origin !== "learned" && !focus.includes(s.url));
  const room = Math.max(0, PAGE_BUDGET - size(focused));
  const chosen = [...focused, ...(question && size(pages) > room ? pickRelevant(pages, question, room) : pages)];
  const label = (s: KnowledgeSource) =>
    s.origin === "learned" ? `From ${s.url} (summary of the website, reviewed by the owner):` : `From ${s.url} (read ${s.last_read_at?.slice(0, 10) ?? "recently"}):`;
  const text = [...pinned, ...chosen].map((s) => `${label(s)}\n${s.content}`).join("\n\n");
  return { info: own.slice(0, MAX_KNOWLEDGE), websites: text ? wrapUntrusted("website_content", text.slice(0, MAX_KNOWLEDGE)) : "" };
}

const size = (sources: KnowledgeSource[]) => sources.reduce((n, s) => n + (s.content?.length ?? 0), 0);

const STOP = new Set(
  "the and for are you your can have has with does what when where which who how our ours this that there their them they about from into any all was were will would could should may might much many some than then also just only very please tell know need want like get got".split(" "),
);
/** Roughly singular / base form: "prices" → "price", "boxes" → "box", "parking" → "park", "glass" stays. */
function stem(w: string): string {
  if (w.endsWith("ies") && w.length > 4) return `${w.slice(0, -3)}y`;
  if (/(ss|is|ous)$/.test(w)) return w;
  if (/(xes|ches|shes|sses|zes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s")) return w.slice(0, -1);
  if (w.endsWith("ing") && w.length > 5) return w.slice(0, -3);
  return w;
}

/** Lowercase words, without common words, roughly singular. */
export function terms(text: string): string[] {
  return (text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9]{3,}/g) ?? [])
    .filter((w) => !STOP.has(w))
    .map(stem)
    .filter((w) => w.length >= 3);
}

/** Splits a page into paragraphs of about CHUNK characters (never mid-line). */
function chunks(text: string): string[] {
  const out: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (current && current.length + line.length > CHUNK) {
      out.push(current);
      current = "";
    }
    current = current ? `${current}\n${line}` : line;
  }
  if (current) out.push(current);
  return out;
}

/**
 * The parts of the pages that best match the question (rarer words count
 * more), up to the budget, kept in page order. Parts that don't match are
 * left out, except each page's opening (title and first lines) when there's
 * room, as context.
 */
export function pickRelevant(sources: KnowledgeSource[], question: string, budget: number): KnowledgeSource[] {
  const wanted = new Set(terms(question));
  const all = sources.flatMap((s, si) => chunks(s.content ?? "").map((text, ci) => ({ si, ci, text, words: new Set(terms(`${ci === 0 ? s.title ?? "" : ""} ${text}`)) })));
  const df = new Map<string, number>();
  for (const c of all) for (const w of c.words) if (wanted.has(w)) df.set(w, (df.get(w) ?? 0) + 1);
  const scored = all.map((c) => ({ ...c, score: [...wanted].reduce((n, w) => n + (c.words.has(w) ? Math.log(1 + all.length / (df.get(w) ?? 1)) : 0), 0) }));
  const matching = scored.filter((c) => c.score > 0).sort((a, b) => b.score - a.score);
  const openings = scored.filter((c) => c.score === 0 && c.ci === 0);
  const picked: typeof scored = [];
  let used = 0;
  for (const c of [...matching, ...openings]) {
    if (used + c.text.length > budget) continue;
    picked.push(c);
    used += c.text.length;
  }
  return sources.flatMap((s, si): KnowledgeSource[] => {
    const parts = picked.filter((c) => c.si === si).sort((a, b) => a.ci - b.ci);
    return parts.length ? [{ ...s, content: parts.map((p) => p.text).join("\n…\n") }] : [];
  });
}
