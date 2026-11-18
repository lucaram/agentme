/**
 * Flight prices for My Agent: what the owner asked for (from, to, dates, travellers), checked by code,
 * and the cheapest offers written out by code (never by the model). Pure: no server code. Unit-tested.
 * Only the trip itself is ever sent to the flight provider: no names, no chat, no profile.
 */
import { z } from "zod";

export const CABINS = ["economy", "premium_economy", "business", "first"] as const;
export type Cabin = (typeof CABINS)[number];

/** What the router takes out of a flight request ("cheapest flight London to Rome next Friday"). */
export const FlightQuerySchema = z.object({
  from: z.string().describe("flights only: where from, a city or airport as the person said it ('London', 'LGW'). Otherwise empty."),
  to: z.string().describe("flights only: where to, a city or airport as said. Otherwise empty."),
  depart: z.string().describe("flights only: the departure date as YYYY-MM-DD, worked out from today's date ('next Friday', '12 Dec'). Empty if no day is given."),
  return: z.string().describe("flights only: the return date as YYYY-MM-DD for a return trip, else empty."),
  adults: z.number().describe("flights only: how many people are flying (1 if not said)."),
  cabin: z.enum(CABINS).describe("flights only: economy unless premium economy, business or first is asked for."),
});
export type FlightQuery = z.infer<typeof FlightQuerySchema>;
export const NO_FLIGHT: FlightQuery = { from: "", to: "", depart: "", return: "", adults: 1, cabin: "economy" };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Airlines sell about 11 months ahead. */
const MAX_DAYS_AHEAD = 330;
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** Ready to search, or the one thing to ask the owner first. */
export function checkFlight(q: FlightQuery, today: string): { ok: true; query: FlightQuery } | { ok: false; ask: string } {
  const from = q.from.trim().slice(0, 60);
  const to = q.to.trim().slice(0, 60);
  if (!from && !to) return { ok: false, ask: "Where are you flying from and to? For example: \"London to Rome on 12 December\"." };
  if (!from) return { ok: false, ask: `Where are you flying to ${to} from?` };
  if (!to) return { ok: false, ask: `Where do you want to fly to from ${from}?` };
  if (!ISO_DAY.test(q.depart)) return { ok: false, ask: `Which day do you want to fly from ${from} to ${to}?` };
  if (day(q.depart) < day(today)) return { ok: false, ask: "That day has already passed. Which day do you want to fly?" };
  if (day(q.depart) > day(today) + MAX_DAYS_AHEAD * 86_400_000) return { ok: false, ask: "Airlines only sell flights about 11 months ahead. Which earlier day would suit you?" };
  const back = ISO_DAY.test(q.return) ? q.return : "";
  if (back && day(back) < day(q.depart)) return { ok: false, ask: "The return day is before the outbound day. Which days do you want to fly?" };
  const adults = Math.min(9, Math.max(1, Math.round(Number(q.adults) || 1)));
  return { ok: true, query: { from, to, depart: q.depart, return: back, adults, cabin: CABINS.includes(q.cabin) ? q.cabin : "economy" } };
}

export type Leg = { from: string; to: string; departs: string; arrives: string; stops: number; duration: string };
export type FlightOffer = { price: number; currency: string; airline: string; out: Leg; back: Leg | null };

type DuffelSegment = { origin?: { iata_code?: string }; destination?: { iata_code?: string }; departing_at?: string; arriving_at?: string };
type DuffelOffer = { total_amount?: string; total_currency?: string; owner?: { name?: string }; slices?: { duration?: string | null; segments?: DuffelSegment[] }[] };

const leg = (slice: { duration?: string | null; segments?: DuffelSegment[] } | undefined): Leg | null => {
  const segs = slice?.segments ?? [];
  if (!segs.length) return null;
  const first = segs[0], last = segs[segs.length - 1];
  return { from: first.origin?.iata_code ?? "", to: last.destination?.iata_code ?? "", departs: first.departing_at ?? "", arrives: last.arriving_at ?? "", stops: segs.length - 1, duration: slice?.duration ?? "" };
};

/** Duffel's offers, cheapest first (the same airline and times only once). */
export function offersFromDuffel(offers: DuffelOffer[]): FlightOffer[] {
  const out: FlightOffer[] = [];
  const seen = new Set<string>();
  for (const o of offers) {
    const price = Number(o.total_amount);
    const outbound = leg(o.slices?.[0]);
    if (!Number.isFinite(price) || !outbound || !o.owner?.name) continue;
    const back = o.slices && o.slices.length > 1 ? leg(o.slices[1]) : null;
    const key = `${o.owner.name}|${outbound.departs}|${back?.departs ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ price, currency: (o.total_currency ?? "GBP").toUpperCase(), airline: o.owner.name, out: outbound, back });
  }
  return out.sort((a, b) => a.price - b.price);
}

const money = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
};
const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const time = (local: string) => local.slice(11, 16);
const hours = (iso: string) => {
  const m = iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?$/);
  if (!m) return "";
  const h = Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0);
  return `${h ? `${h}h` : ""}${m[3] ? `${h ? " " : ""}${Number(m[3])}m` : ""}`;
};
const legText = (l: Leg) => {
  const nextDay = l.arrives.slice(0, 10) > l.departs.slice(0, 10) ? " (+1)" : "";
  const stops = l.stops === 0 ? "direct" : `${l.stops} ${l.stops === 1 ? "stop" : "stops"}`;
  return `${time(l.departs)} ${l.from} → ${time(l.arrives)}${nextDay} ${l.to} · ${stops}${l.duration ? ` · ${hours(l.duration)}` : ""}`;
};

/** A link to compare and book the same trip (the agent itself never books). */
export const compareLink = (fromCode: string, toCode: string, q: FlightQuery) =>
  `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${fromCode} to ${toCode} on ${q.depart}${q.return ? ` returning ${q.return}` : ""}`)}`;

/** The answer: the trip, the three cheapest options, and what the prices are (and aren't). */
export function flightsMessage(q: FlightQuery, places: { from: string; to: string }, offers: FlightOffer[], opts: { test: boolean; shown?: number }): string {
  const who = `${q.adults} ${q.adults === 1 ? "adult" : "adults"}`;
  const cabin = q.cabin === "economy" ? "" : ` · ${q.cabin.replace("_", " ")}`;
  const head = `✈️ ${places.from} → ${places.to} · ${dayLabel(q.depart)}${q.return ? ` – ${dayLabel(q.return)} (return)` : ""} · ${who}${cabin}`;
  if (!offers.length) return `${head}\n\nI couldn't find any flights for that trip. Try another day or a nearby airport?`;
  const shown = offers.slice(0, opts.shown ?? 3);
  const lines = shown.map((o, i) => {
    const price = `${money(o.price, o.currency)}${q.adults > 1 ? ` for ${who}` : ""}${q.return ? " return" : ""}`;
    return `${i + 1}. **${o.airline}** · ${price}\n   ${legText(o.out)}${o.back ? `\n   Back: ${legText(o.back)}` : ""}`;
  });
  const note = `Cheapest of ${offers.length} ${offers.length === 1 ? "option" : "options"}, checked just now. Prices change quickly, and nothing is booked: book with the airline or compare below.`;
  return [head, lines.join("\n"), note, opts.test ? "🧪 Test data (flight provider's test mode): not real prices." : ""].filter(Boolean).join("\n\n");
}
