import {
  heuristicIntent,
  heuristicPlan,
  heuristicReply,
  type ParticipantReply,
} from "@/lib/coordination/heuristics";
import { recordUsage } from "@/lib/usage/meter";
import { mockModeration } from "@/lib/social/moderation";
import { describeRecall, type RecallPlan } from "@/lib/agents/recall-format";
import { heuristicCompose } from "@/lib/plans/compose";
import { mockChanges, mockLearn, type PageText } from "@/lib/business/learn";
import { LLMError, type LLMObjectRequest, type LLMProvider, type LLMRequest, type LLMFindRequest, type LLMFindResult, type LLMResearchRequest, type LLMResearchResult } from "./types";
import { mockResearch } from "@/lib/research/mock";
import { mockRoute, overlapPick } from "@/lib/research/answer";

type Faq = { q: string; a: string };
type BusinessInfo = { description?: string; hours?: string; faqs?: Faq[] };

/**
 * Deterministic stand-in for a real model. Used by tests, CI and offline demos
 * (LLM_PROVIDER=mock). Works only from `mockContext`, which callers build from
 * the same (already minimised) data they put into the prompt.
 */
export class MockProvider implements LLMProvider {
  readonly name = "mock";

  async research(req: LLMResearchRequest): Promise<LLMResearchResult> {
    const result = { ...mockResearch(req.question), errors: [], pagesRead: 1 };
    await meterMock({ purpose: "research", system: req.system, messages: [{ role: "user", content: req.question }] }, result.text);
    return result;
  }

  async findPages(req: LLMFindRequest): Promise<LLMFindResult> {
    // The stand-in for the web only knows the pages its research stand-in cites.
    const pages = mockResearch(req.question).sources.map((s) => ({ url: s.url, title: s.title }));
    await meterMock({ purpose: "find", system: "", messages: [{ role: "user", content: req.question }] }, JSON.stringify(pages));
    return { pages, errors: [] };
  }

  async generateText(req: LLMRequest): Promise<string> {
    const ctx = (req.mockContext ?? {}) as Record<string, unknown>;
    let text: string;
    switch (req.purpose) {
      case "owner_chat": {
        const recall = (ctx.recall ?? []) as RecallPlan[];
        const asksAboutPlans = /\b(what time|when|who|replied|answer|agree|poll|vote|result|plan|coming)\b/i.test(String(ctx.text ?? ""));
        text =
          asksAboutPlans && recall.length
            ? describeRecall(String(ctx.text ?? ""), recall)
            : "I can coordinate plans with your contacts' agents, run polls and ask them questions. Try: \"Arrange dinner with @marco and @paul on Saturday evening.\"";
        break;
      }
      case "chat_assist": {
        // Deterministic stand-ins for summarise / translate / draft / answer.
        const lines = (ctx.lines ?? []) as string[];
        switch (ctx.mode) {
          case "summarise":
            text = lines.length ? `Summary of the last ${lines.length} messages: ${lines.slice(-5).join(" | ")}` : "Nothing to summarise yet.";
            break;
          case "translate":
            text = `(${String(ctx.language)}) ${String(ctx.text ?? "")}`;
            break;
          case "draft":
            text = `Sounds good — ${String(ctx.instruction ?? "")}`.trim();
            break;
          default:
            text = "I can summarise this chat, translate or draft a reply for you, or organise something with everyone here. Try “@agent poll: pizza or sushi?”.";
        }
        break;
      }
      case "research": {
        // Answering from pages the app read itself: the first line of a page that mentions the question's words.
        const pages = (ctx.pages ?? []) as { text: string }[];
        const words = new Set(keywords(String(ctx.question ?? "")));
        const line = pages.flatMap((p) => p.text.split("\n")).find((l) => keywords(l).some((w) => words.has(w)));
        text = line ? `STATUS: answered\n${line.trim()}` : "STATUS: not_found\nThe pages don't say.";
        break;
      }
      case "business_ingest":
        // Deterministic stand-in for reading a PDF or photo.
        text = `(Read from ${String(ctx.kind ?? "file")}) ${String(ctx.hint ?? "Menu items and prices")}`;
        break;
      case "business_changes":
        text = mockChanges((ctx.added ?? []) as string[], (ctx.removed ?? []) as string[]);
        break;
      case "ask_around_summary": {
        // Deterministic: one labelled line per tip.
        const tips = (ctx.tips ?? []) as { handle: string; answer: string }[];
        text = tips.map((t) => `- **@${t.handle}:** ${t.answer}`).join("\n");
        break;
      }
      case "business_faq":
        text = answerFaq(String(ctx.question ?? ""), (ctx.businessInfo ?? {}) as BusinessInfo);
        break;
      default:
        throw new LLMError(`Mock has no text output for ${req.purpose}`, "invalid_output");
    }
    await meterMock(req, text);
    return text;
  }

  async generateObject<T>(req: LLMObjectRequest<T>): Promise<T> {
    const ctx = (req.mockContext ?? {}) as Record<string, unknown>;
    let value: unknown;
    switch (req.purpose) {
      case "compose":
        value = heuristicCompose(String(ctx.text ?? ""), (ctx.chatMembers ?? []) as string[]);
        break;
      case "intent":
        value = heuristicIntent(String(ctx.text ?? ""));
        break;
      case "coordination_reply":
        value = heuristicReply(
          (ctx.facts ?? {}) as Partial<Record<"availability" | "food" | "location", string>>,
          String(ctx.window ?? ""),
        );
        break;
      case "moderation":
        value = mockModeration(String(ctx.text ?? ""), (ctx.houseRules ?? []) as string[]);
        break;
      case "business_faq": {
        // Deterministic: FAQs, then a line of the business's info/website mentioning the question's words.
        const knowledge = String(ctx.knowledge ?? "");
        const answer = answerFaq(String(ctx.question ?? ""), (ctx.businessInfo ?? {}) as BusinessInfo, knowledge);
        value = { answer, needs_team: answer.startsWith("I don't have"), source_url: mockSourceOf(answer, knowledge) };
        break;
      }
      case "route":
        value = mockRoute(String(ctx.text ?? ""), String(ctx.quoted ?? ""));
        break;
      case "keywords":
        // The stand-in keeps the question's own words (no translation).
        value = { words: keywords(String(ctx.question ?? "")).join(" ") };
        break;
      case "pick":
        value = { pages: overlapPick(String(ctx.question ?? ""), (ctx.candidates ?? []) as { url: string; title: string }[], 2).map((i) => i + 1) };
        break;
      case "business_learn":
        value = mockLearn((ctx.pages ?? []) as PageText[]);
        break;
      case "proposal":
        value = heuristicPlan(
          String(ctx.organiser),
          (ctx.replies ?? []) as ParticipantReply[],
          String(ctx.event ?? "meetup"),
          String(ctx.window ?? ""),
        );
        break;
      default:
        throw new LLMError(`Mock has no object output for ${req.purpose}`, "invalid_output");
    }
    const parsed = req.schema.safeParse(value);
    if (!parsed.success) throw new LLMError("Mock output did not match schema.", "invalid_output");
    await meterMock(req, JSON.stringify(parsed.data));
    return parsed.data;
  }
}

/** Mock calls are free but still metered (≈4 chars/token) so usage tracking is testable. */
async function meterMock(req: LLMRequest, output: string) {
  const input = req.system.length + req.messages.reduce((n, m) => n + m.content.length, 0);
  await recordUsage({
    purpose: req.purpose,
    provider: "mock",
    model: "mock",
    inputTokens: Math.ceil(input / 4),
    outputTokens: Math.ceil(output.length / 4),
    ok: true,
  });
}

/**
 * The website page an answer line came from: a page block ("From <url> (read …):")
 * containing it. Not the owner's own words, and not the reviewed summary (which
 * repeats the same sentences but isn't a page).
 */
export function mockSourceOf(answer: string, knowledge: string): string {
  const start = knowledge.indexOf("<website_content>");
  if (!answer || start < 0) return "";
  let page = "";
  for (const raw of knowledge.slice(start).split("\n")) {
    const line = raw.trim();
    const header = line.match(/^From (\S+) \((read [^)]*|summary[^)]*)\):$/);
    if (header) page = header[2].startsWith("read") ? header[1] : "";
    else if (page && line.includes(answer)) return page;
  }
  return "";
}

const STOPWORDS = new Set(["the", "you", "your", "can", "are", "have", "has", "for", "and", "any", "there", "what", "with", "does", "how", "our"]);
const keywords = (s: string) => (s.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !STOPWORDS.has(w));

function answerFaq(question: string, info: BusinessInfo, knowledge = ""): string {
  // Booking requests always get the "no bookings" answer, whatever the FAQs say.
  if (/\b(book|reserve|reservation)\b/i.test(question) && !/\bgroup/i.test(question)) {
    return "I can't take bookings or check live availability. Please contact the business directly to reserve.";
  }
  const words = new Set(keywords(question));
  let best: Faq | undefined;
  let bestScore = 0;
  for (const faq of info.faqs ?? []) {
    const score = keywords(faq.q).filter((w) => words.has(w) || words.has(w.replace(/s$/, ""))).length;
    if (score > bestScore) [best, bestScore] = [faq, score];
  }
  if (best) return best.a;
  // A line that mentions what was asked: the owner's own words first, then the website's pages, then its reviewed summary.
  const blocks: Record<"own" | "page" | "summary", string[]> = { own: [], page: [], summary: [] };
  let block: keyof typeof blocks = "own";
  for (const raw of knowledge.split("\n")) {
    const line = raw.trim();
    if (/^From \S+ \(read [^)]*\):$/.test(line)) block = "page";
    else if (/^From \S+ \(summary/.test(line)) block = "summary";
    // Headers, tags and questions aren't answers.
    if (!line || /^(Business:|From |Q: |<\/?\w)/.test(line) || line.endsWith("?")) continue;
    // "A: …" and "… (site/page)" are how the summary is written; the answer is the text itself.
    blocks[block].push(block === "summary" ? line.replace(/^A: /, "").replace(/ \([^()]*\)$/, "") : line);
  }
  const mentions = (l: string) => keywords(l).some((w) => words.has(w) || words.has(`${w}s`) || words.has(w.replace(/s$/, "")));
  const hit = [...blocks.own, ...blocks.page, ...blocks.summary].find(mentions);
  if (hit) return hit;
  if (/\b(open|hours|close|closing)\b/i.test(question) && info.hours) return `Our opening hours: ${info.hours}`;
  return "I don't have that information. Please contact the business directly.";
}
