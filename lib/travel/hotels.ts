/**
 * Hotel prices for My Agent: what the owner asked for (city, dates, guests, budget), checked by code,
 * and the best options written out by code (never by the model). Pure: no server code. Unit-tested.
 * Only the stay itself is ever sent to the hotel provider: no names, no chat, no profile.
 */
import { z } from "zod";

/** What the router takes out of a hotel request ("hotels in Rome 12–14 December for 2 under £150"). */
export const HotelQuerySchema = z.object({
  city: z.string().describe("hotels only: the city or town to stay in. Otherwise empty."),
  country: z.string().describe("hotels only: that city's country as a 2-letter ISO code (Rome → IT, London → GB). Otherwise empty."),
  checkin: z.string().describe("hotels only: check-in date as YYYY-MM-DD, worked out from today's date. Empty if not given."),
  checkout: z.string().describe("hotels only: check-out date as YYYY-MM-DD (from 'for 3 nights' too). Empty if not given."),
  adults: z.number().describe("hotels only: how many people are staying (2 if not said and it sounds like a couple, else 1)."),
  max_per_night: z.number().describe("hotels only: the most per night they want to pay, as a number ('under £150' → 150). 0 if not said."),
  currency: z.string().describe("hotels only: the currency they used as a 3-letter code (£ → GBP, € → EUR, $ → USD). GBP if not said."),
  sort: z.enum(["price", "rating"]).describe("hotels only: rating when they ask for the best or top-rated, else price."),
});
export type HotelQuery = z.infer<typeof HotelQuerySchema>;
export const NO_HOTEL: HotelQuery = { city: "", country: "", checkin: "", checkout: "", adults: 1, max_per_night: 0, currency: "GBP", sort: "price" };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
export const nightsOf = (q: Pick<HotelQuery, "checkin" | "checkout">) => Math.round((day(q.checkout) - day(q.checkin)) / DAY_MS);

/** Ready to search, or the one thing to ask the owner first. */
export function checkHotel(q: HotelQuery, today: string): { ok: true; query: HotelQuery } | { ok: false; ask: string } {
  const city = q.city.trim().slice(0, 60);
  if (!city) return { ok: false, ask: "Which city or town do you want to stay in? For example: \"hotels in Rome 12 to 14 December for 2\"." };
  if (!ISO_DAY.test(q.checkin)) return { ok: false, ask: `Which nights do you want to stay in ${city}? For example: "12 to 14 December".` };
  if (!ISO_DAY.test(q.checkout)) return { ok: false, ask: `Until when do you want to stay in ${city}? (Or how many nights?)` };
  if (day(q.checkin) < day(today)) return { ok: false, ask: "That check-in day has already passed. Which nights do you want to stay?" };
  if (day(q.checkin) > day(today) + 365 * DAY_MS) return { ok: false, ask: "Hotels only show prices up to about a year ahead. Which earlier nights would suit you?" };
  const nights = nightsOf(q);
  if (nights < 1) return { ok: false, ask: "The check-out day needs to be after the check-in day. Which nights do you want to stay?" };
  if (nights > 30) return { ok: false, ask: "I can look up stays of up to 30 nights. Which nights do you want?" };
  // The hotel provider needs the country (there's more than one Paris).
  const country = /^[A-Za-z]{2}$/.test(q.country.trim()) ? q.country.trim().toUpperCase() : "";
  if (!country) return { ok: false, ask: `Which country is ${city} in?` };
  const currency = /^[A-Za-z]{3}$/.test(q.currency.trim()) ? q.currency.trim().toUpperCase() : "GBP";
  const adults = Math.min(8, Math.max(1, Math.round(Number(q.adults) || 1)));
  const max = Number(q.max_per_night) > 0 ? Math.round(Number(q.max_per_night)) : 0;
  return { ok: true, query: { city, country, checkin: q.checkin, checkout: q.checkout, adults, max_per_night: max, currency, sort: q.sort === "rating" ? "rating" : "price" } };
}

/** Rooms for the guests: two to a room. */
export const roomsFor = (adults: number) => Array.from({ length: Math.ceil(adults / 2) }, (_, i) => ({ adults: Math.min(2, adults - i * 2) }));

export type HotelOffer = {
  name: string; stars: number | null; rating: number | null; reviews: number | null; address: string;
  total: number; currency: string; room: string; board: string; refundable: boolean; taxesAtHotel: number;
};

type LiteRate = { name?: string; boardName?: string; retailRate?: { total?: { amount?: number; currency?: string }[]; taxesAndFees?: { included?: boolean; amount?: number }[] | null }; cancellationPolicies?: { refundableTag?: string } };
type LiteHotelRates = { hotelId?: string; roomTypes?: { offerRetailRate?: { amount?: number; currency?: string }; rates?: LiteRate[] }[] };
type LiteHotel = { id?: string; name?: string; address?: string; stars?: number | null; rating?: number | null; review_count?: number | null };

/** LiteAPI's results: each hotel's cheapest offer, with the hotel's details. */
export function offersFromLite(data: LiteHotelRates[], hotels: LiteHotel[]): HotelOffer[] {
  const byId = new Map(hotels.filter((h) => h.id).map((h) => [h.id!, h]));
  const out: HotelOffer[] = [];
  for (const h of data) {
    const info = h.hotelId ? byId.get(h.hotelId) : undefined;
    if (!info?.name) continue;
    let best: HotelOffer | null = null;
    for (const room of h.roomTypes ?? []) {
      const rate = room.rates?.[0];
      const total = Number(room.offerRetailRate?.amount ?? rate?.retailRate?.total?.[0]?.amount);
      if (!rate || !Number.isFinite(total) || total <= 0) continue;
      if (best && best.total <= total) continue;
      best = {
        name: info.name, stars: info.stars ?? null, rating: info.rating ?? null, reviews: info.review_count ?? null, address: info.address ?? "",
        total, currency: (room.offerRetailRate?.currency ?? rate.retailRate?.total?.[0]?.currency ?? "GBP").toUpperCase(),
        room: rate.name ?? "", board: rate.boardName ?? "", refundable: rate.cancellationPolicies?.refundableTag === "RFN",
        taxesAtHotel: (rate.retailRate?.taxesAndFees ?? []).filter((t) => t.included === false).reduce((n, t) => n + (Number(t.amount) || 0), 0),
      };
    }
    if (best) out.push(best);
  }
  return out;
}

/**
 * The options to show: within the budget per night; by price (the well-reviewed first when there are
 * enough of them) or by guest rating when the best is asked for.
 */
export function pickHotels(offers: HotelOffer[], q: HotelQuery, count = 3): { shown: HotelOffer[]; matching: number } {
  const nights = Math.max(1, nightsOf(q));
  const fits = offers.filter((o) => !q.max_per_night || o.total / nights <= q.max_per_night);
  const byPrice = (a: HotelOffer, b: HotelOffer) => a.total - b.total;
  if (q.sort === "rating") return { shown: [...fits].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || byPrice(a, b)).slice(0, count), matching: fits.length };
  const good = fits.filter((o) => (o.rating ?? 0) >= 7.5);
  return { shown: (good.length >= count ? good : fits).sort(byPrice).slice(0, count), matching: fits.length };
}

/** Room prices in whole pounds ("£107 for 2 nights (£53 a night)"); a small tax keeps its pence ("£25.56"). */
const money = (amount: number, currency: string, whole = amount >= 100 || Number.isInteger(amount)) => {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(amount);
  } catch {
    return `${Math.round(amount)} ${currency}`;
  }
};
const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** A link to look the hotel up (the agent itself never books). */
export const hotelLink = (name: string, city: string) => `https://www.google.com/search?q=${encodeURIComponent(`${name} ${city}`)}`;

/** The answer: the stay, the best options, and what the prices are (and aren't). */
export function hotelsMessage(q: HotelQuery, offers: HotelOffer[], opts: { test: boolean }): string {
  const nights = nightsOf(q);
  const rooms = roomsFor(q.adults).length;
  const who = `${q.adults} ${q.adults === 1 ? "adult" : "adults"}${rooms > 1 ? `, ${rooms} rooms` : ""}`;
  const head = `🏨 ${q.city} · ${dayLabel(q.checkin)} – ${dayLabel(q.checkout)} (${nights} ${nights === 1 ? "night" : "nights"}) · ${who}${q.max_per_night ? ` · up to ${money(q.max_per_night, q.currency)} a night` : ""}`;
  const { shown, matching } = pickHotels(offers, q);
  if (!shown.length) {
    return `${head}\n\n${offers.length && q.max_per_night ? `None of the ${offers.length} hotels with rooms is within ${money(q.max_per_night, q.currency)} a night. The cheapest is ${money(Math.min(...offers.map((o) => o.total)) / nights, offers[0].currency, true)} a night.` : "I couldn't find hotels with rooms for those nights. Try other dates?"}`;
  }
  const lines = shown.map((o, i) => {
    const stars = o.stars ? ` ${"★".repeat(Math.min(5, Math.round(o.stars)))}` : "";
    const rating = o.rating ? ` · ${o.rating.toFixed(1)}/10${o.reviews ? ` (${o.reviews.toLocaleString("en-GB")} reviews)` : ""}` : "";
    const price = `${money(o.total, o.currency, true)} for ${nights} ${nights === 1 ? "night" : "nights"}${nights > 1 ? ` (${money(o.total / nights, o.currency, true)} a night)` : ""}`;
    const terms = [o.board.toLowerCase(), o.refundable ? "refundable" : "non-refundable"].filter(Boolean).join(" · ");
    const extra = [o.address, o.taxesAtHotel ? `+ ${money(o.taxesAtHotel, o.currency)} taxes paid at the hotel` : ""].filter(Boolean).join(" · ");
    return `${i + 1}. **${o.name}**${stars}${rating}\n   ${price} · ${terms}${extra ? `\n   ${extra}` : ""}`;
  });
  const order = q.sort === "rating" ? "Best rated" : "Best value";
  const note = `${order} of ${matching} ${matching === 1 ? "hotel" : "hotels"} with rooms${q.max_per_night ? " in your budget" : ""}, checked just now. Prices change quickly, and nothing is booked.`;
  return [head, lines.join("\n"), note, opts.test ? "🧪 Test data (hotel provider's sandbox): not real prices." : ""].filter(Boolean).join("\n\n");
}
