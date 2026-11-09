/**
 * Community autopilot (moderation step 2): an AI check of a message against
 * the community's rules, turned into an action by CODE, not by the model:
 *   - near-certain spam/scam or clear abuse → not posted, author told why;
 *   - possibly disrespectful, selling or off-topic → a private nudge first
 *     ("Edit, or post anyway?"), the author decides;
 *   - everything else → posted.
 * Nothing waits for a moderator. Pure (no server code), unit-tested.
 */
import { z } from "zod";

export const VERDICTS = ["ok", "disrespectful", "abusive", "spam", "selling", "off_topic"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const ModerationSchema = z.object({
  verdict: z
    .enum(VERDICTS)
    .describe(
      "ok = fine (banter, disagreement and strong opinions are fine); disrespectful = rude or dismissive toward someone; abusive = insults, harassment, slurs or threats aimed at someone; spam = scams, link spam, repeated promotion, get-rich-quick; selling = selling or promoting something; off_topic = clearly unrelated to what the community is about.",
    ),
  confidence: z.number().min(0).max(1).describe("How sure you are, 0 to 1. Only use 0.9+ when it is unmistakable."),
  reason: z.string().max(200).describe("One short, kind sentence addressed to the author explaining the concern. Empty when ok."),
});
export type Moderation = z.infer<typeof ModerationSchema>;

/** How sure the check must be before code acts. */
export const THRESHOLDS = { refuseSpam: 0.9, refuseAbuse: 0.85, nudge: 0.6, reportsAgree: 0.7, reportsNeeded: 3 } as const;

const RULE: Record<Exclude<Verdict, "ok">, string> = {
  disrespectful: "Be respectful",
  abusive: "Be respectful",
  spam: "No spam or selling",
  selling: "No spam or selling",
  off_topic: "Stay on topic",
};

export type Decision =
  | { action: "post" }
  | { action: "refuse"; rule: string; message: string }
  | { action: "nudge"; rule: string; message: string };

export function decide(m: Moderation): Decision {
  if (m.verdict === "ok") return { action: "post" };
  const rule = RULE[m.verdict];
  const why = m.reason.trim() ? ` ${m.reason.trim()}` : "";
  if (m.verdict === "spam" && m.confidence >= THRESHOLDS.refuseSpam) {
    return { action: "refuse", rule, message: `🤖 Not posted: this looks like spam.${why}` };
  }
  if (m.verdict === "abusive" && m.confidence >= THRESHOLDS.refuseAbuse) {
    return { action: "refuse", rule, message: `🤖 Not posted: this breaks “${rule}”.${why}` };
  }
  if (m.confidence >= THRESHOLDS.nudge) {
    return { action: "nudge", rule, message: `This might break “${rule}”.${why}` };
  }
  return { action: "post" };
}

/** Does the check agree that a reported message breaks a rule? */
export const agreesWithReports = (m: Moderation) => m.verdict !== "ok" && m.confidence >= THRESHOLDS.reportsAgree;

// ------------------------------------------------------------- deterministic stand-in (tests, no API key)

const ABUSIVE = /\b(hate you|f\*?u?ck you|piece of shit|kill yourself)\b/i;
const RUDE = /\b(idiot|stupid|moron|loser|shut up|clown)\b/i;
const SPAM = /\b(free money|click here|guaranteed returns?|win an? (?:iphone|prize)|limited offer|double your money)\b/i;
const SELL = /[£$€]\s?\d|\bfor sale\b|\bselling\b|\bbuy now\b|\bdm me\b|\bpromo code\b/i;

export function mockModeration(text: string): Moderation {
  if (ABUSIVE.test(text)) return { verdict: "abusive", confidence: 0.95, reason: "Please don't attack other members." };
  if (SPAM.test(text)) return { verdict: "spam", confidence: 0.95, reason: "It reads like a scam or advert." };
  if (RUDE.test(text)) return { verdict: "disrespectful", confidence: 0.8, reason: "It could come across as rude." };
  if (SELL.test(text)) return { verdict: "selling", confidence: 0.75, reason: "Selling isn't allowed here." };
  return { verdict: "ok", confidence: 0.9, reason: "" };
}
