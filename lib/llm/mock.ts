import {
  heuristicIntent,
  heuristicPlan,
  heuristicReply,
  type ParticipantReply,
} from "@/lib/coordination/heuristics";
import { recordUsage } from "@/lib/usage/meter";
import { describeRecall, type RecallPlan } from "@/lib/agents/recall-format";
import { heuristicCompose } from "@/lib/plans/compose";
import { LLMError, type LLMObjectRequest, type LLMProvider, type LLMRequest } from "./types";

type Faq = { q: string; a: string };
type BusinessInfo = { description?: string; hours?: string; faqs?: Faq[] };

/**
 * Deterministic stand-in for a real model. Used by tests, CI and offline demos
 * (LLM_PROVIDER=mock). Works only from `mockContext`, which callers build from
 * the same (already minimised) data they put into the prompt.
 */
export class MockProvider implements LLMProvider {
  readonly name = "mock";

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
        value = heuristicCompose(String(ctx.text ?? ""));
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

const STOPWORDS = new Set(["the", "you", "your", "can", "are", "have", "has", "for", "and", "any", "there", "what", "with", "does", "how", "our"]);
const keywords = (s: string) => (s.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !STOPWORDS.has(w));

function answerFaq(question: string, info: BusinessInfo): string {
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
  if (/\b(open|hours|close|closing)\b/i.test(question) && info.hours) return `Our opening hours: ${info.hours}`;
  return "I don't have that information. Please contact the business directly.";
}
