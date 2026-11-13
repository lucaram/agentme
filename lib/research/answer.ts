/**
 * Shared research: one answer format for your agent, business agents and
 * inline "@agent", with where each fact came from. Pure (no server code),
 * unit-tested. The rules code enforces, not the model:
 *  - a researched answer without sources is never presented as verified;
 *  - numbers in an answer must appear in what was actually read;
 *  - an unclear request becomes a question with options, not a guess.
 */
import { z } from "zod";

export type ResearchSource = { url: string; title: string; quote?: string; retrievedAt?: string; pageAge?: string };

export type AnswerStatus = "answered" | "partial" | "needs_clarification" | "not_found" | "unavailable";
export type Answer = {
  status: AnswerStatus;
  text: string;
  sources: ResearchSource[];
  retrievedAt: string;
  /** Numbers in the text that weren't found in what was read. */
  unverified?: string[];
  clarification?: { question: string; options: string[] };
};

/** now: weather, live scores, "today"; recent: news; past: reviews, history; none: timeless. */
export type TimeClass = "now" | "recent" | "past" | "none";

export const RouteSchema = z.object({
  kind: z.enum(["chat", "research"]).describe("research = needs current or specific public facts from the web (weather, news, scores, prices, reviews, opening times of places, facts about organisations or products). chat = everything else: ideas, wording, opinions, the user's own plans, general knowledge that doesn't change."),
  question: z.string().describe("research only: the request rewritten as one standalone question a search engine could answer, with nothing private in it. Otherwise empty."),
  time: z.enum(["now", "recent", "past", "none"]).describe("now = current conditions or today/tomorrow; recent = news from the last weeks; past = a dated event or an older article; none otherwise."),
  place: z.string().describe("A city or place named in the request (for weather or local results), or empty."),
});
export type Route = z.infer<typeof RouteSchema>;

const RESEARCH_HINT =
  /\b(weather|forecast|temperature|rain(ing)?|snow(ing)?|news|headlines?|latest|score|result|who won|review(s|ed)?|rating|price of|how much (is|are|does)|release date|opening (hours|times)|meteo|notizie|recensione|punteggio|voto|prezzo)\b/i;
const NOW_HINT = /\b(weather|forecast|temperature|rain(ing)?|snow(ing)?|right now|today|tonight|tomorrow|meteo|oggi|domani|adesso)\b/i;
const RECENT_HINT = /\b(news|headlines?|latest|this week|notizie|ultime)\b/i;

/** Deterministic stand-in for the router (tests, no API key). */
export function mockRoute(text: string): Route {
  const research = RESEARCH_HINT.test(text);
  const place = text.match(/\b(?:in|at|near|a|ad)\s+([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)?)/u)?.[1] ?? "";
  return {
    kind: research ? "research" : "chat",
    question: research ? text.trim().slice(0, 300) : "",
    time: NOW_HINT.test(text) ? "now" : RECENT_HINT.test(text) ? "recent" : "none",
    place,
  };
}

/** How long a researched answer may be reused. */
export function cacheSeconds(time: TimeClass): number {
  return time === "now" ? 30 * 60 : time === "recent" ? 6 * 3600 : 7 * 86_400;
}

/** The same question about the same sources (case, spacing and punctuation don't matter). */
export function cacheText(question: string, domains: readonly string[] = []): string {
  const q = question.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return `${[...domains].sort().join(",")}|${q}`;
}

/**
 * What the research model writes: a first line "STATUS: answered|not_found|
 * needs_clarification", then the answer; for a clarification, the question and
 * "OPTION: …" lines.
 */
export function parseResearchText(raw: string): { status: AnswerStatus; text: string; clarification?: { question: string; options: string[] } } {
  const lines = raw.trim().split("\n");
  const head = lines.findIndex((l) => /^\s*STATUS:/i.test(l));
  const status = head >= 0 ? lines[head].replace(/^\s*STATUS:\s*/i, "").trim().toLowerCase() : "";
  const body = (head >= 0 ? lines.slice(head + 1) : lines).filter((l) => !/^\s*OPTION:/i.test(l)).join("\n").trim();
  const options = lines.filter((l) => /^\s*OPTION:/i.test(l)).map((l) => l.replace(/^\s*OPTION:\s*/i, "").trim()).filter(Boolean).slice(0, 5);
  if (status.startsWith("needs_clarification") && options.length >= 2) return { status: "needs_clarification", text: body, clarification: { question: body, options } };
  if (status.startsWith("not_found") || !body) return { status: "not_found", text: body || "I couldn't find a reliable source for that." };
  return { status: "answered", text: body };
}

/** Numbers worth checking: prices, scores, percentages, temperatures, years, anything with 2+ digits or a decimal. */
const NUMBER = /\d+(?:[.,]\d+)?/g;

/** Numbers in the answer that don't appear anywhere in what was read (decimal comma and point are the same). */
export function unverifiedNumbers(text: string, evidence: readonly string[]): string[] {
  if (!evidence.length) return [];
  const seen = evidence.join("\n").replace(/,/g, ".");
  const out = new Set<string>();
  for (const n of text.match(NUMBER) ?? []) {
    if (n.length < 2) continue; // single digits are usually counts or list numbers
    if (!seen.includes(n.replace(/,/g, "."))) out.add(n);
  }
  return [...out];
}

/** Applies the code rules to what the model wrote. */
export function buildAnswer(raw: string, sources: ResearchSource[], evidence: readonly string[], now = new Date()): Answer {
  const parsed = parseResearchText(raw);
  const retrievedAt = now.toISOString();
  if (parsed.status !== "answered") return { ...parsed, sources: parsed.status === "needs_clarification" ? sources : [], retrievedAt };
  // No sources: not verified, so never presented as an answer.
  if (!sources.length) return { status: "not_found", text: "I couldn't verify that from a source, so I'd rather not guess.", sources: [], retrievedAt };
  const unverified = unverifiedNumbers(parsed.text, evidence);
  return { status: unverified.length ? "partial" : "answered", text: parsed.text, sources, retrievedAt, ...(unverified.length ? { unverified } : {}) };
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** The answer as a message from an agent: text, a caution for unconfirmed numbers, and its sources. */
export function answerMessage(a: Answer): string {
  if (a.status === "needs_clarification" && a.clarification) {
    return `${a.clarification.question}\n${a.clarification.options.map((o) => `- ${o}`).join("\n")}\n\nTell me which one and I'll look it up.`;
  }
  if (a.status === "not_found" || a.status === "unavailable") return a.text;
  const caution = a.unverified?.length ? `\n\n⚠️ I couldn't confirm ${a.unverified.join(", ")} in the pages I read: check the source.` : "";
  // The sources themselves are shown as links under the message (metadata.sources); the text names where it's from.
  const from = [...new Set(a.sources.slice(0, 3).map((s) => host(s.url)))].join(", ");
  return `${a.text}${caution}\n\n🔗 From ${from}`;
}

/** The answer as text to put in your own message: short, with one source line you can delete. */
export function answerForDraft(a: Answer): string {
  if (a.status !== "answered" && a.status !== "partial") return "";
  return `${a.text}${a.sources[0] ? `\n(Source: ${a.sources[0].url})` : ""}`;
}
