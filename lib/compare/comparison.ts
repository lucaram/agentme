/**
 * Comparing businesses from My Agent: the points asked, each business's answers read into cells,
 * and the summary lines. The summary is worked out here in code (never by the AI): only stated
 * answers count, and nothing is ranked on a missing one. Pure: unit-tested.
 */
import { z } from "zod";

export const MIN_COMPARE = 2;
export const MAX_COMPARE = 5;
export const MAX_POINTS = 4;

export const ComparePointSchema = z.object({
  label: z.string().min(1).max(60).describe("Short label, e.g. 'Margherita pizza: price' or 'Parking'."),
  kind: z.enum(["price", "yes_no", "text"]).describe("price: a price of something; yes_no: does it have/offer something; text: a short answer (e.g. opening time)."),
  question: z.string().min(3).max(200).describe("The question to ask each business, the same for all, e.g. 'How much is a margherita pizza?'"),
});
export const ComparePointsSchema = z.object({
  vague: z.boolean().describe("True when it's not clear what to compare (e.g. 'which is best?')."),
  points: z.array(ComparePointSchema).max(MAX_POINTS),
});
export type ComparePoint = z.infer<typeof ComparePointSchema>;

/** What a business's answer says, point by point (read by the AI from the answer's own words). */
export const CellReadingSchema = z.object({
  cells: z.array(z.object({
    point: z.number().int().min(0).describe("The point's number, from 0."),
    stated: z.boolean().describe("True only if the answer actually states it. False if it says it doesn't know, or doesn't say."),
    text: z.string().max(120).describe("The answer in a few words, e.g. '£8.50' or 'Free car park behind the restaurant'."),
    number: z.number().nullable().describe("For a price: the amount (8.5). Otherwise null."),
    basis: z.enum(["fixed", "from", "per_hour", "per_person"]).nullable().describe("For a price: fixed, or 'from' ('from £30'), per_hour or per_person. Otherwise null."),
    currency: z.string().max(3).nullable().describe("For a price: GBP, EUR or USD. Otherwise null."),
    yes: z.boolean().nullable().describe("For yes/no: true or false when stated. Otherwise null."),
    detail: z.string().max(60).nullable().describe("A detail that matters for comparing, e.g. the size '12-inch'. Otherwise null."),
  })),
});

export type CellStatus = "asking" | "answered" | "not_stated" | "timeout" | "unreachable" | "team_asked" | "team_answered" | "team_none";
export type CompareCell = {
  business_id: string;
  point: number;
  status: CellStatus;
  text?: string | null;
  number?: number | null;
  /** How the price is given: only fixed prices (or unstated) are ranked. */
  basis?: "fixed" | "from" | "per_hour" | "per_person" | null;
  currency?: string | null;
  yes?: boolean | null;
  detail?: string | null;
  /** Where the business's agent found it ("menu.pdf", "trattoria.example"), when it said. */
  source?: string | null;
  /** The A2A task of the question: links a later answer from the business's team to this cell. */
  a2a_task?: string | null;
  /** The business's agent didn't know and offered to ask its team. */
  handoff?: boolean;
  /** Asked within the last day: that answer was used again. */
  reused?: boolean;
};
export type ComparedBusiness = { id: string; handle: string; name: string };
export type Comparison = { kind: "business_comparison"; points: ComparePoint[]; businesses: ComparedBusiness[]; cells: CompareCell[] };

const SYMBOL: Record<string, string> = { GBP: "£", EUR: "€", USD: "$" };
export const money = (n: number, currency: string | null | undefined) => `${SYMBOL[currency ?? ""] ?? ""}${n.toFixed(n % 1 ? 2 : 0)}${SYMBOL[currency ?? ""] ? "" : currency ? ` ${currency}` : ""}`;
const names = (list: string[]) => (list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`);

/** "📄 From trattoria.example/menu.pdf · checked today" at the end of an answer → "menu.pdf"; the answer without it. */
export function splitSource(answer: string): { text: string; source: string | null } {
  // From Prices & facilities: "(from menu.pdf, read 18 Nov)" or "(confirmed by the business)".
  const note = answer.match(/\s*\((from [^()]{1,90}, read [^()]{1,20}|confirmed by the business)\)\.?\s*$/i);
  if (note) return { text: answer.slice(0, note.index).trim(), source: note[1].replace(/^from /i, "") };
  const m = answer.match(/\n*📄 From (\S+) · checked [^\n]+\s*$/);
  if (!m) return { text: answer.trim(), source: null };
  const path = m[1].replace(/\/+$/, "");
  const last = path.split("/").pop() ?? path;
  return { text: answer.slice(0, m.index).trim(), source: /\.(pdf|jpe?g|png|webp)$/i.test(last) ? last : path.split("/")[0] };
}

/** The summary lines under the card. */
export function summarise(c: Pick<Comparison, "points" | "businesses" | "cells">): string[] {
  const name = (id: string) => c.businesses.find((b) => b.id === id)?.name ?? "A business";
  const lines: string[] = [];
  c.points.forEach((point, index) => {
    const cells = c.cells.filter((cell) => cell.point === index);
    const stated = cells.filter((cell) => (cell.status === "answered" || cell.status === "team_answered"));
    const subject = point.label.replace(/:\s*price$/i, "");
    if (point.kind === "price") {
      const all = stated.filter((cell) => typeof cell.number === "number");
      // "from £30" or "£40 per hour" isn't ranked against a fixed price.
      const priced = all.filter((cell) => !cell.basis || cell.basis === "fixed");
      const unranked = all.length - priced.length;
      if (!priced.length) return void lines.push(unranked ? `Prices for ${subject.toLowerCase()} are given as "from" or per hour, so they aren't ranked.` : `No business stated a price for ${subject.toLowerCase()}.`);
      // Only prices in the same currency are compared (the most common one).
      const counts = new Map<string, number>();
      for (const cell of priced) counts.set(cell.currency ?? "", (counts.get(cell.currency ?? "") ?? 0) + 1);
      const currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const same = priced.filter((cell) => (cell.currency ?? "") === currency);
      const low = Math.min(...same.map((cell) => cell.number!));
      const cheapest = same.filter((cell) => cell.number === low).map((cell) => name(cell.business_id));
      const sizes = new Set(same.map((cell) => (cell.detail ?? "").trim().toLowerCase()));
      let line = `Cheapest stated ${subject.toLowerCase()}: ${names(cheapest)} (${money(low, currency || null)}).`;
      if (same.length > 1 && sizes.size > 1) line += " Sizes may differ.";
      if (same.length < priced.length) line += " Prices in another currency aren't compared.";
      if (same.length === 1 && cells.length > 1) line = `Only ${name(same[0].business_id)} stated a price for ${subject.toLowerCase()} (${money(low, currency || null)}).`;
      if (unranked) line += ` ${unranked === 1 ? "One price is" : "Some prices are"} given as "from" or per hour and ${unranked === 1 ? "isn't" : "aren't"} ranked.`;
      lines.push(line);
    } else if (point.kind === "yes_no") {
      const yes = stated.filter((cell) => cell.yes === true).map((cell) => name(cell.business_id));
      const unsaid = cells.length - stated.filter((cell) => cell.yes !== null && cell.yes !== undefined).length;
      const topic = subject.toLowerCase();
      if (!yes.length) lines.push(unsaid === cells.length ? `No business said anything about ${topic}.` : `No business says it has ${topic}.`);
      else lines.push(yes.length === 1 ? `${topic[0].toUpperCase()}${topic.slice(1)}: only ${yes[0]} says yes.` : `${topic[0].toUpperCase()}${topic.slice(1)}: ${names(yes)} say yes.`);
    }
  });
  return lines;
}
