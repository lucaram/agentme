import { z } from "zod";
import type { RecallPlan } from "./recall-format";

export const RecallRouteSchema = z.object({
  kind: z.enum(["recall", "other"]).describe("recall: asking about an existing personal/group plan, agreement, attendance, votes, assignments or answers. other: creating/changing a plan, or asking public/business information. A venue @handle identifies a place; it is not an instruction to contact it."),
  matches: z.array(z.number().int().positive()).describe("All plans that could match, numbered from 1. Include every plausible match; never choose arbitrarily between similar plans. Empty when no saved plan matches, or kind is other."),
});

/** Conservative local fallback, also used by the offline model. */
export function isRecallQuestion(text: string): boolean {
  if (/^\s*(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:organise|organize|arrange|schedule|create|set up|cancel|change|move|reschedule|invite)\b/i.test(text)) return false;
  return /\b(what time (did we|have we|is our|are we)|when (did we|are we|is our)|who('s| is| are)? (coming|going|replied)|who.*(voted|bringing|assigned)|what.*(we agree|we agreed|we decide|we decided)|our (dinner|lunch|meeting|plan)|poll results?|who (has|hasn't|has not) (replied|answered|voted))\b|\bwho('s| is| are)? in\s*[?.!]*$/i.test(text);
}

export function mockRecallRoute(text: string, plans: RecallPlan[]) {
  if (!isRecallQuestion(text)) return { kind: "other" as const, matches: [] };
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const q = clean(text);
  const dates = q.match(/\b\d{1,4}\b/g) ?? [];
  const namedVenue = plans.filter((p) => p.venue && [p.venue.handle, p.venue.name].some((n) => q.includes(clean(n))));
  const pool = namedVenue.length ? namedVenue : plans;
  const eventWords = ["dinner", "lunch", "meeting", "coffee", "poll", "football"].filter((w) => q.includes(w));
  const matches = pool.filter((p) => (!dates.length || dates.every((d) => clean(p.when ?? "").split(" ").includes(d))) && (!eventWords.length || eventWords.some((w) => clean(p.title).includes(w))));
  return { kind: "recall" as const, matches: matches.map((p) => plans.indexOf(p) + 1) };
}

export function recallChoice(plans: RecallPlan[], matches: number[]): { plan: RecallPlan } | { text: string; choices: RecallPlan[] } {
  const found = [...new Set(matches)].map((n) => plans[n - 1]).filter((p): p is RecallPlan => Boolean(p));
  if (found.length === 1) return { plan: found[0] };
  if (!found.length) return { text: "I couldn't find a matching plan in your saved plans. Which event and date do you mean? I haven't contacted the business.", choices: [] };
  return { text: `Which plan do you mean?\n${found.map((p, i) => `${i + 1}. ${p.title}${p.when ? ` — ${p.when}` : ""}${p.venue ? ` at ${p.venue.name}` : ""}`).join("\n")}`, choices: found };
}
