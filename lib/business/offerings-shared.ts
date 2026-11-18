/**
 * "Prices & facilities": what was read from a business's website and documents, as the business has
 * checked it. Pure (no server code): the facility list, merging a fresh read with the business's
 * corrections, and the notes saying where each fact comes from. Unit-tested.
 */
import { z } from "zod";

export const FACILITIES = [
  { key: "parking", label: "Parking", icon: "🅿️" },
  { key: "step_free_access", label: "Step-free access", icon: "♿" },
  { key: "accessible_toilet", label: "Accessible toilet", icon: "🚻" },
  { key: "outdoor_seating", label: "Outdoor seating", icon: "☀️" },
  { key: "dog_friendly", label: "Dog-friendly", icon: "🐕" },
  { key: "vegetarian_options", label: "Vegetarian options", icon: "🥗" },
  { key: "vegan_options", label: "Vegan options", icon: "🌱" },
  { key: "gluten_free_options", label: "Gluten-free options", icon: "🌾" },
  { key: "kids_menu", label: "Kids' menu", icon: "🧒" },
  { key: "wifi", label: "Wi-Fi", icon: "📶" },
  { key: "card_payments", label: "Card payments", icon: "💳" },
  { key: "takeaway", label: "Takeaway", icon: "🥡" },
] as const;
export type FacilityKey = (typeof FACILITIES)[number]["key"];
export const FACILITY_KEYS = FACILITIES.map((f) => f.key) as [FacilityKey, ...FacilityKey[]];
export const MAX_PRICES = 300;
/** Facilities a business names itself ("Live music", "Private room"). */
export const MAX_CUSTOM_FACILITIES = 20;
export const isCustomFacility = (key: string) => /^custom-[a-z0-9]{8}$/.test(key);

export const OfferingsSchema = z.object({
  prices: z.array(z.object({
    item: z.string().min(1).max(120).describe("The item as written, e.g. 'Margherita pizza'."),
    variant: z.string().max(60).nullable().describe("Size or option when it matters, e.g. '12-inch', 'glass', 'large'. Otherwise null."),
    price: z.number().min(0).max(99999).describe("The amount, e.g. 8.5."),
    currency: z.string().length(3).describe("GBP, EUR, USD…"),
  })).max(MAX_PRICES),
  facilities: z.array(z.object({
    key: z.enum(FACILITY_KEYS),
    status: z.enum(["yes", "no"]).describe("Only what the text states: 'yes' or 'no'. Leave out anything it doesn't mention."),
    evidence: z.string().max(300).describe("The words it's based on, e.g. 'free car park behind the restaurant'."),
  })),
});
export type Offerings = z.infer<typeof OfferingsSchema>;

export type PriceRow = { id: string; item: string; variant: string | null; price: number; currency: string; source_url: string | null; source_label: string | null; visibility: string; found_price: number | null; corrected: boolean; added: boolean; hidden: boolean; read_at: string | null };
export type FacilityRow = { key: string; label: string | null; status: string; evidence: string | null; source_url: string | null; source_label: string | null; visibility: string; confirmed: boolean; hidden: boolean; updated_at: string };

/** Its name and icon: one of the common facilities, or the business's own name for it. */
export function facilityName(row: Pick<FacilityRow, "key" | "label">): { label: string; icon: string } {
  const common = FACILITIES.find((f) => f.key === row.key);
  return common ? { label: common.label, icon: common.icon } : { label: row.label ?? "Facility", icon: "✨" };
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const priceKey = (p: { item: string; variant: string | null }) => `${norm(p.item)}|${norm(p.variant)}`;

/** "menu.pdf" for a file; "sole.example/visit" for a page. */
export function sourceLabel(url: string): string {
  const clean = url.replace(/^https?:\/\//, "").replace(/[?#].*$/, "").replace(/\/+$/, "").replace(/^www\./, "");
  const last = clean.split("/").pop() ?? clean;
  return (/\.(pdf|jpe?g|png|webp|txt)$/i.test(last) ? decodeURIComponent(last) : clean).slice(0, 80);
}

const when = (iso: string | null, now: number) => {
  if (!iso) return "recently";
  const day = (t: number) => Math.floor(t / 86_400_000);
  const diff = day(now) - day(Date.parse(iso));
  return diff <= 0 ? "today" : diff === 1 ? "yesterday" : new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
};

/** Where a fact comes from, for the agent and the card: "from menu.pdf, read 18 Nov" / "confirmed by the business". */
export function priceNote(p: Pick<PriceRow, "corrected" | "added" | "source_label" | "read_at">, now = Date.now()): string {
  return p.corrected || p.added || !p.source_label ? "confirmed by the business" : `from ${p.source_label}, read ${when(p.read_at, now)}`;
}
export function facilityNote(f: Pick<FacilityRow, "confirmed" | "source_label" | "updated_at">, now = Date.now()): string {
  return f.confirmed || !f.source_label ? "confirmed by the business" : `from ${f.source_label}, read ${when(f.updated_at, now)}`;
}

const SYMBOL: Record<string, string> = { GBP: "£", EUR: "€", USD: "$" };
export const formatPrice = (n: number, currency: string) => `${SYMBOL[currency] ?? ""}${Number(n).toFixed(2)}${SYMBOL[currency] ? "" : ` ${currency}`}`;

/** What the business's agent knows from Prices & facilities (only what this audience may see; nothing hidden). */
export function offeringsKnowledge(prices: PriceRow[], facilities: FacilityRow[], audience: "public" | "customers", now = Date.now()): string {
  const visible = <T extends { visibility: string }>(rows: T[]) => rows.filter((r) => r.visibility === "public" || audience === "customers");
  const priceLines = visible(prices).filter((p) => !p.hidden).map((p) => `- ${p.item}${p.variant ? ` (${p.variant})` : ""}: ${formatPrice(p.price, p.currency)} (${priceNote(p, now)})`);
  const facilityLines = visible(facilities).filter((f) => !f.hidden).map((f) => {
    const { label } = facilityName(f);
    return `- ${label}: ${f.status === "yes" ? "yes" : "no"}${f.evidence ? `, ${f.evidence}` : ""} (${facilityNote(f, now)})`;
  });
  return [
    priceLines.length ? `Prices (read from the business's website and documents, checked by the business):\n${priceLines.join("\n")}` : "",
    facilityLines.length ? `Facilities:\n${facilityLines.join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

export type PricePlan = { insert: Offerings["prices"]; update: { id: string; patch: Partial<Omit<PriceRow, "id">> }[]; remove: string[] };

/**
 * A fresh read of one source against what's saved from it: new prices are added; a changed price is
 * updated, unless the business corrected it (then only what the document says is noted); prices the
 * source no longer lists go, unless the business corrected them (those stay, as the business's own).
 */
export function planPrices(existing: PriceRow[], found: Offerings["prices"], readAt: string): PricePlan {
  const plan: PricePlan = { insert: [], update: [], remove: [] };
  const seen = new Set<string>();
  const byKey = new Map(existing.map((row) => [priceKey(row), row]));
  for (const item of found) {
    const key = priceKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    const row = byKey.get(key);
    if (!row) plan.insert.push(item);
    else if (row.corrected) plan.update.push({ id: row.id, patch: { found_price: item.price, read_at: readAt } });
    else plan.update.push({ id: row.id, patch: { price: item.price, currency: item.currency.toUpperCase(), found_price: item.price, read_at: readAt } });
  }
  for (const row of existing) {
    if (seen.has(priceKey(row))) continue;
    if (row.corrected) plan.update.push({ id: row.id, patch: { added: true, source_url: null, source_label: null } });
    else plan.remove.push(row.id);
  }
  return plan;
}

/** Worth reading for prices and facilities at all (most website pages aren't). */
export const mentionsOfferings = (text: string) =>
  /[£$€]\s?\d|\d\s?(?:EUR|GBP|USD)\b|\b(parking|car park|wheelchair|step-free|accessible|outdoor|terrace|garden|dog|vegetarian|vegan|gluten|kids|children's menu|wi-?fi|card|contactless|cash only|takeaway|take-away|take away)\b/i.test(text);

/** The test stand-in for reading: "Item (size) £8.50" lines, and a few facility phrases. */
export function mockOfferings(text: string): Offerings {
  const prices: Offerings["prices"] = [];
  for (const line of text.split(/\n/)) {
    const m = line.match(/^\s*[-•*]?\s*(\p{L}[\p{L}' &-]{1,60}?)\s*(?:\(([^)]{1,30})\))?\s*[:\-–]?\s*([£$€])\s?(\d+(?:\.\d{1,2})?)\s*$/u);
    if (m) prices.push({ item: m[1].trim(), variant: m[2]?.trim() ?? null, price: Number(m[4]), currency: { "£": "GBP", "€": "EUR", $: "USD" }[m[3]]! });
  }
  const facilities: Offerings["facilities"] = [];
  const quote = (re: RegExp) => text.match(re)?.[0].trim() ?? "";
  if (/\bno parking\b|street parking only/i.test(text)) facilities.push({ key: "parking", status: "no", evidence: quote(/[^.\n]*(no parking|street parking only)[^.\n]*/i) });
  else if (/\b(car park|parking)\b/i.test(text)) facilities.push({ key: "parking", status: "yes", evidence: quote(/[^.\n]*(car park|parking)[^.\n]*/i) });
  if (/\bdogs? (are )?welcome\b|dog[- ]friendly/i.test(text)) facilities.push({ key: "dog_friendly", status: "yes", evidence: quote(/[^.\n]*dog[^.\n]*/i) });
  if (/\bvegan\b/i.test(text)) facilities.push({ key: "vegan_options", status: "yes", evidence: quote(/[^.\n]*vegan[^.\n]*/i) });
  return { prices, facilities };
}
