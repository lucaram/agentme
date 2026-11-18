/**
 * "Prices & facilities": what was read from a business's website and documents, as the business has
 * checked it. Pure (no server code): products and services (one item, several options), the facility
 * list, merging a fresh read with the business's own changes, and the notes saying where each fact
 * comes from. Unit-tested.
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
/** Priced options per business (an item with three sizes counts three). */
export const MAX_PRICES = 300;
/** Facilities a business names itself ("Live music", "Private room"). */
export const MAX_CUSTOM_FACILITIES = 20;
export const isCustomFacility = (key: string) => /^custom-[a-z0-9]{8}$/.test(key);

// ------------------------------------------------------------- products and services

export const KINDS = ["product", "service"] as const;
export type Kind = (typeof KINDS)[number];
export const PRICE_TYPES = ["fixed", "from", "per_hour", "per_person", "free", "on_request"] as const;
export type PriceType = (typeof PRICE_TYPES)[number];
export const PRICE_TYPE_LABEL: Record<PriceType, string> = { fixed: "Fixed price", from: "From", per_hour: "Per hour", per_person: "Per person", free: "Free", on_request: "Price on request" };
/** Tags customers ask about ("vegan dishes under £10"); a business can add its own. */
export const COMMON_TAGS = ["Vegetarian", "Vegan", "Gluten-free", "Spicy", "Contains nuts", "Popular", "Seasonal"] as const;
export const TAG_ICON: Record<string, string> = { Vegetarian: "🥗", Vegan: "🌱", "Gluten-free": "🌾", Spicy: "🌶️", "Contains nuts": "🥜", Popular: "⭐", Seasonal: "🍂" };
export const MAX_TAGS = 8;

// No length or range limits here: the model can't be held to them, and one long description must not
// throw away a whole menu. tidyOfferings applies the limits afterwards, item by item.
const ItemSchema = z.object({
  kind: z.enum(KINDS).describe("product: something a customer buys (a dish, a drink, goods). service: something the business does (a haircut, a repair, room hire, delivery, a lesson)."),
  category: z.string().nullable().describe("The heading it's listed under in the document, e.g. 'Pizza', 'Starters', 'Colour'. Null if there isn't one."),
  item: z.string().describe("The name, cleaned: without labels like (V) or (HOT), and in normal capitals, e.g. 'Masala dosa'."),
  description: z.string().nullable().describe("A short description (one sentence) if the document gives one. Otherwise null."),
  tags: z.array(z.string()).describe(`Labels the document gives it, as tags: ${COMMON_TAGS.join(", ")} (e.g. (V) → Vegetarian, (HOT) → Spicy, (VG) → Vegan, (GF) → Gluten-free).`),
  price_type: z.enum(PRICE_TYPES).describe("fixed; from ('from £30'); per_hour; per_person; free; on_request ('price on request')."),
  duration_minutes: z.number().nullable().describe("For a service: how long it takes, in minutes, if stated. Otherwise null."),
  needs_booking: z.boolean().describe("For a service: true if the document says it must be booked."),
  currency: z.string().describe("GBP, EUR, USD…"),
  options: z.array(z.object({
    label: z.string().nullable().describe("The size or option ('10-inch', 'glass', 'large'), or null when there's only one price."),
    price: z.number().nullable().describe("The amount, e.g. 8.5. Null for free or price on request."),
  })),
});
export const OfferingsSchema = z.object({
  items: z.array(ItemSchema),
  facilities: z.array(z.object({
    key: z.enum(FACILITY_KEYS),
    status: z.enum(["yes", "no"]).describe("Only what the text states: 'yes' or 'no'. Leave out anything it doesn't mention."),
    evidence: z.string().describe("The words it's based on, e.g. 'free car park behind the restaurant'."),
  })),
});
export type Offerings = z.infer<typeof OfferingsSchema>;
export type FoundItem = Offerings["items"][number];

/** One priced option (a row); an item is its rows with the same group_id. */
export type PriceRow = {
  id: string; group_id: string; kind: string; category: string | null; item: string; variant: string | null; description: string | null; tags: string[];
  price_type: string; price: number | null; currency: string; duration_minutes: number | null; needs_booking: boolean;
  source_url: string | null; source_label: string | null; visibility: string; found_price: number | null; found_item: string | null;
  corrected: boolean; added: boolean; hidden: boolean; read_at: string | null;
};
export type FacilityRow = { key: string; label: string | null; status: string; evidence: string | null; source_url: string | null; source_label: string | null; visibility: string; confirmed: boolean; hidden: boolean; updated_at: string };

/** An item as the business sees and edits it: its options together. */
export type Item = {
  group_id: string; kind: Kind; category: string | null; item: string; description: string | null; tags: string[];
  price_type: PriceType; currency: string; duration_minutes: number | null; needs_booking: boolean;
  options: { id: string; label: string | null; price: number | null; found_price: number | null; corrected: boolean; added: boolean; hidden: boolean }[];
  /** All options hidden. */ hidden: boolean;
  /** Changed by the business (or added by it). */ corrected: boolean;
  /** Every option added by the business (nothing read from a document). */ added: boolean;
  source_label: string | null; read_at: string | null; visibility: string;
};

/** Rows → items (options in the order saved: smallest price first). */
export function groupItems(rows: PriceRow[]): Item[] {
  const groups = new Map<string, PriceRow[]>();
  for (const row of rows) groups.set(row.group_id, [...(groups.get(row.group_id) ?? []), row]);
  return [...groups.values()].map((options) => {
    const first = options[0];
    const sorted = [...options].sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
    const read = options.find((o) => o.source_label && !o.added);
    return {
      group_id: first.group_id, kind: (first.kind === "service" ? "service" : "product") as Kind, category: first.category, item: first.item, description: first.description,
      tags: first.tags ?? [], price_type: (PRICE_TYPES as readonly string[]).includes(first.price_type) ? (first.price_type as PriceType) : "fixed", currency: first.currency,
      duration_minutes: first.duration_minutes, needs_booking: first.needs_booking,
      options: sorted.map((o) => ({ id: o.id, label: o.variant, price: o.price === null ? null : Number(o.price), found_price: o.found_price === null ? null : Number(o.found_price), corrected: o.corrected, added: o.added, hidden: o.hidden })),
      hidden: options.every((o) => o.hidden), corrected: options.some((o) => o.corrected), added: options.every((o) => o.added),
      source_label: read?.source_label ?? null, read_at: read?.read_at ?? null, visibility: options.some((o) => o.visibility === "public") ? "public" : "customers",
    };
  }).sort((a, b) => (a.category ?? "~").localeCompare(b.category ?? "~") || a.item.localeCompare(b.item));
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const priceKey = (p: { item: string; variant: string | null }) => `${norm(p.item)}|${norm(p.variant)}`;

/** Tags tidied: the common ones spelled as listed, no duplicates, at most eight. */
export function cleanTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.trim().replace(/\s+/g, " ").slice(0, 30);
    if (!t) continue;
    const common = COMMON_TAGS.find((c) => c.toLowerCase() === t.toLowerCase());
    const tag = common ?? t[0].toUpperCase() + t.slice(1);
    if (!out.some((o) => o.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out.slice(0, MAX_TAGS);
}

// ------------------------------------------------------------- where prices come from

export type SourceRow = {
  id: string; url: string; origin: string; status: string; error: string | null;
  offerings_error: string | null; offerings_reading_at: string | null; offerings_read_at: string | null; last_read_at: string | null;
};
/** One row of "Where your prices come from": a document or link, or the website's pages together. */
export type PriceSource = { key: string; label: string; site: boolean; pages: number; items: number; reading: boolean; error: string | null; readAt: string | null };

/** A read that hasn't ended after this long is taken to have stopped. */
const READING_MS = 10 * 60_000;
export const readingPrices = (s: Pick<SourceRow, "offerings_reading_at">, now = Date.now()) => Boolean(s.offerings_reading_at && now - Date.parse(s.offerings_reading_at) < READING_MS);
/** Being fetched, or being read for prices and facilities. */
export const readingSource = (s: Pick<SourceRow, "status" | "offerings_reading_at">, now = Date.now()) => s.status === "pending" || s.status === "reading" || readingPrices(s, now);

export function priceSources(sources: SourceRow[], prices: PriceRow[], now: number, siteLabel: string | null): PriceSource[] {
  const items = new Map<string, Set<string>>();
  for (const p of prices) if (p.source_url && !p.hidden && !p.added) items.set(p.source_url, (items.get(p.source_url) ?? new Set()).add(p.group_id));
  const count = (url: string) => items.get(url)?.size ?? 0;
  const pages = sources.filter((s) => s.origin === "site");
  const site: PriceSource = {
    key: "site", label: siteLabel ?? "Your website", site: true,
    pages: pages.filter((s) => count(s.url) > 0).length,
    items: pages.reduce((n, s) => n + count(s.url), 0),
    reading: pages.some((s) => readingPrices(s, now)),
    error: pages.find((s) => s.offerings_error)?.offerings_error ?? null,
    readAt: pages.map((s) => s.offerings_read_at).filter((x): x is string => Boolean(x)).sort().at(-1) ?? null,
  };
  const links = sources.filter((s) => s.origin === "link").map((s) => ({
    key: s.id, label: sourceLabel(s.url), site: false, pages: 1, items: count(s.url), reading: readingSource(s, now),
    error: s.status === "error" ? s.error : s.offerings_error, readAt: s.offerings_read_at ?? s.last_read_at,
  }));
  return [...(site.items || site.reading || site.error ? [site] : []), ...links];
}

// ------------------------------------------------------------- reading long documents

/** Text read in one go; a longer menu is read in parts, side by side. */
export const READ_PART = 4000;
const MAX_OPTIONS = 12;
const clip = (s: string | null | undefined, max: number) => {
  const t = (s ?? "").trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > max / 2 ? cut.lastIndexOf(" ") : cut.length)}…`;
};

/** Split at line ends into parts of at most `size` characters (a very long line is cut). */
export function splitForReading(text: string, size = READ_PART): string[] {
  const parts: string[] = [];
  let part = "";
  for (let line of text.split("\n")) {
    while (line.length > size) {
      if (part) parts.push(part);
      part = "";
      parts.push(line.slice(0, size));
      line = line.slice(size);
    }
    if (part && part.length + 1 + line.length > size) {
      parts.push(part);
      part = "";
    }
    part = part ? `${part}\n${line}` : line;
  }
  if (part.trim()) parts.push(part);
  return parts;
}

/**
 * What was read, held to what can be saved: names and descriptions shortened, prices that make sense,
 * at most twelve options, an item without any price left out (unless free or on request).
 */
export function tidyOfferings(found: Offerings): Offerings {
  const items: FoundItem[] = [];
  for (const it of found.items) {
    const item = clip(it.item, 120);
    if (!item) continue;
    const priced = it.price_type === "free" || it.price_type === "on_request";
    const options = it.options
      .map((o) => ({ label: clip(o.label, 60) || null, price: typeof o.price === "number" && Number.isFinite(o.price) && o.price >= 0 && o.price < 100000 ? Math.round(o.price * 100) / 100 : null }))
      .filter((o) => priced || o.price !== null)
      .slice(0, MAX_OPTIONS);
    if (!options.length) continue;
    const minutes = typeof it.duration_minutes === "number" ? Math.round(it.duration_minutes) : null;
    const currency = (it.currency ?? "").trim().toUpperCase();
    items.push({
      ...it, item, options,
      category: clip(it.category, 60) || null,
      description: clip(it.description, 200) || null,
      tags: cleanTags(it.tags),
      duration_minutes: minutes && minutes >= 1 && minutes <= 1440 ? minutes : null,
      currency: /^[A-Z]{3}$/.test(currency) ? currency : "GBP",
    });
  }
  return {
    items: items.slice(0, MAX_PRICES),
    facilities: found.facilities.map((f) => ({ ...f, evidence: clip(f.evidence, 300) })),
  };
}

/** The parts of one document, back together: an item whose options were split across parts is one item again. */
export function mergeOfferings(parts: Offerings[]): Offerings {
  const items: FoundItem[] = [];
  const byName = new Map<string, FoundItem>();
  // A part that starts in the middle of a section: its first items without a heading carry on the last one.
  let last: string | null = null;
  const all = parts.flatMap((p) => {
    let leading = true;
    const items = p.items.map((it) => {
      if (it.category) leading = false;
      return leading && !it.category && last ? { ...it, category: last } : it;
    });
    last = items.at(-1)?.category ?? last;
    return items;
  });
  for (const it of all) {
    const key = `${it.kind}|${norm(it.category)}|${norm(it.item)}`;
    const same = byName.get(key);
    if (!same) {
      const copy = { ...it, options: [...it.options] };
      byName.set(key, copy);
      items.push(copy);
      continue;
    }
    for (const o of it.options) if (!same.options.some((x) => norm(x.label) === norm(o.label))) same.options.push(o);
    same.description ??= it.description;
    same.tags = cleanTags([...same.tags, ...it.tags]);
  }
  const facilities = new Map<string, Offerings["facilities"][number]>();
  for (const f of parts.flatMap((p) => p.facilities)) if (!facilities.has(f.key)) facilities.set(f.key, f);
  return { items, facilities: [...facilities.values()] };
}

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

/** "£8.50", "from £30.00", "£40.00 per hour", "£25.00 per person", "Free", "Price on request". */
export function priceText(price: number | null, type: PriceType, currency: string): string {
  if (type === "free") return "Free";
  if (type === "on_request" || price === null) return "Price on request";
  const amount = formatPrice(price, currency);
  return type === "from" ? `from ${amount}` : type === "per_hour" ? `${amount} per hour` : type === "per_person" ? `${amount} per person` : amount;
}
/** "45 min", "1 h 30". */
export const durationText = (minutes: number) => (minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60}` : ""}`);

/** What the business's agent knows from Prices & facilities (only what this audience may see; nothing hidden). */
export function offeringsKnowledge(prices: PriceRow[], facilities: FacilityRow[], audience: "public" | "customers", now = Date.now()): string {
  const visible = <T extends { visibility: string }>(rows: T[]) => rows.filter((r) => r.visibility === "public" || audience === "customers");
  const items = groupItems(visible(prices).filter((p) => !p.hidden));
  const line = (i: Item) => {
    const options = i.options.map((o) => `${o.label ? `${o.label} ` : ""}${priceText(o.price, i.price_type, i.currency)}`).join("; ");
    const extra = [i.duration_minutes ? durationText(i.duration_minutes) : "", i.needs_booking ? "booking needed" : ""].filter(Boolean).join(", ");
    return `- ${i.category ? `${i.category} › ` : ""}${i.item}${i.tags.length ? ` [${i.tags.join(", ")}]` : ""}: ${options}${extra ? `, ${extra}` : ""}${i.description ? `. ${i.description}` : ""} (${priceNote({ corrected: i.corrected, added: i.added, source_label: i.source_label, read_at: i.read_at }, now)})`;
  };
  const products = items.filter((i) => i.kind === "product").map(line);
  const services = items.filter((i) => i.kind === "service").map(line);
  const facilityLines = visible(facilities).filter((f) => !f.hidden).map((f) => {
    const { label } = facilityName(f);
    return `- ${label}: ${f.status === "yes" ? "yes" : "no"}${f.evidence ? `, ${f.evidence}` : ""} (${facilityNote(f, now)})`;
  });
  return [
    products.length ? `Prices of products (read from the business's website and documents, checked by the business):\n${products.join("\n")}` : "",
    services.length ? `Prices of services:\n${services.join("\n")}` : "",
    facilityLines.length ? `Facilities:\n${facilityLines.join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

/** Its name and icon: one of the common facilities, or the business's own name for it. */
export function facilityName(row: Pick<FacilityRow, "key" | "label">): { label: string; icon: string } {
  const common = FACILITIES.find((f) => f.key === row.key);
  return common ? { label: common.label, icon: common.icon } : { label: row.label ?? "Facility", icon: "✨" };
}

/** A read item's details as saved on each of its rows. */
export function itemFields(i: FoundItem) {
  return {
    kind: i.kind, category: i.category?.trim() || null, item: i.item.trim(), description: i.description?.trim() || null, tags: cleanTags(i.tags),
    price_type: i.price_type, currency: i.currency.toUpperCase(), duration_minutes: i.kind === "service" ? i.duration_minutes : null, needs_booking: i.kind === "service" && i.needs_booking,
  };
}

export type NewRow = ReturnType<typeof itemFields> & { group_id: string | null; variant: string | null; price: number | null; found_item: string };
export type PricePlan = { insert: NewRow[]; update: { id: string; patch: Partial<Omit<PriceRow, "id">> }[]; remove: string[] };

/**
 * A fresh read of one source against what's saved from it. New options are added (to their item when it's
 * already there); a changed price or detail is updated, unless the business changed that item (then only
 * what the document says is noted); options the source no longer lists go, unless the business changed
 * them (those stay, as the business's own).
 */
export function planPrices(existing: PriceRow[], found: FoundItem[], readAt: string): PricePlan {
  const plan: PricePlan = { insert: [], update: [], remove: [] };
  const seen = new Set<string>();
  // Matched by the name it was read under (the business may have renamed it since).
  const readKey = (row: PriceRow) => priceKey({ item: row.found_item ?? row.item, variant: row.variant });
  const byKey = new Map(existing.map((row) => [readKey(row), row]));
  const groupOf = new Map(existing.map((row) => [norm(row.found_item ?? row.item), row.group_id]));
  for (const item of found) {
    const fields = itemFields(item);
    for (const option of item.options) {
      const key = priceKey({ item: fields.item, variant: option.label });
      if (seen.has(key)) continue;
      seen.add(key);
      const row = byKey.get(key);
      const price = fields.price_type === "free" ? 0 : fields.price_type === "on_request" ? null : option.price;
      if (!row) plan.insert.push({ ...fields, group_id: groupOf.get(norm(fields.item)) ?? null, variant: option.label?.trim() || null, price, found_item: fields.item });
      else if (row.corrected) plan.update.push({ id: row.id, patch: { found_price: price, read_at: readAt } });
      else plan.update.push({ id: row.id, patch: { ...fields, price, found_price: price, read_at: readAt } });
    }
  }
  for (const row of existing) {
    if (seen.has(readKey(row))) continue;
    if (row.corrected) plan.update.push({ id: row.id, patch: { added: true, source_url: null, source_label: null } });
    else plan.remove.push(row.id);
  }
  return plan;
}

/** Worth reading for prices and facilities at all (most website pages aren't). */
export const mentionsOfferings = (text: string) =>
  /[£$€]\s?\d|\d\s?(?:EUR|GBP|USD)\b|\b(price on request|parking|car park|wheelchair|step-free|accessible|outdoor|terrace|garden|dog|vegetarian|vegan|gluten|kids|children's menu|wi-?fi|card|contactless|cash only|takeaway|take-away|take away)\b/i.test(text);

const LABEL_TAGS: [RegExp, string][] = [[/\((v|veg)\)/i, "Vegetarian"], [/\((vg|vegan)\)/i, "Vegan"], [/\((gf)\)/i, "Gluten-free"], [/\((hot|spicy)\)/i, "Spicy"]];

/**
 * The test stand-in for reading: a heading line starts a category; "Item (size) £8.50" lines are options
 * (same name: one item); "(V)", "(HOT)"… become tags; "from £", "per hour", "(30 min)" make a service.
 */
export function mockOfferings(text: string): Offerings {
  const items: FoundItem[] = [];
  let category: string | null = null;
  for (const raw of text.split(/\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^[-•*]?\s*(\p{L}[\p{L}\p{N}' &().-]*?)\s*(?:\[([^\]]{1,30})\])?\s*[:\-–]?\s*(from\s+)?([£$€])\s?(\d+(?:\.\d{1,2})?)(\s+per\s+(?:hour|person))?(?:\s*\((\d{1,3})\s*min\))?\s*$/iu);
    if (!m) {
      if (/^[\p{L}][\p{L} &'-]{1,40}$/u.test(line) && !/[.!?]$/.test(line) && line.split(" ").length <= 4) category = line;
      continue;
    }
    let name = m[1].trim();
    const tags: string[] = [];
    for (const [re, tag] of LABEL_TAGS) if (re.test(name)) { tags.push(tag); name = name.replace(new RegExp(re.source, "gi"), "").trim(); }
    // "Margherita pizza (12-inch)": what's left in brackets is the option.
    const sized = name.match(/^(.*?)\s*\(([^)]{1,30})\)$/);
    if (sized && !m[2]) { name = sized[1].trim(); m[2] = sized[2]; }
    const service = Boolean(m[3] || m[6] || m[7]);
    const type: PriceType = m[3] ? "from" : /hour/i.test(m[6] ?? "") ? "per_hour" : /person/i.test(m[6] ?? "") ? "per_person" : "fixed";
    const currency = { "£": "GBP", "€": "EUR", $: "USD" }[m[4]]!;
    const existing = items.find((i) => norm(i.item) === norm(name));
    const option = { label: m[2]?.trim() ?? null, price: Number(m[5]) };
    if (existing) existing.options.push(option);
    else items.push({ kind: service ? "service" : "product", category, item: name, description: null, tags, price_type: type, duration_minutes: m[7] ? Number(m[7]) : null, needs_booking: false, currency, options: [option] });
  }
  const facilities: Offerings["facilities"] = [];
  const quote = (re: RegExp) => text.match(re)?.[0].trim() ?? "";
  if (/\bno parking\b|street parking only/i.test(text)) facilities.push({ key: "parking", status: "no", evidence: quote(/[^.\n]*(no parking|street parking only)[^.\n]*/i) });
  else if (/\b(car park|parking)\b/i.test(text)) facilities.push({ key: "parking", status: "yes", evidence: quote(/[^.\n]*(car park|parking)[^.\n]*/i) });
  if (/\bdogs? (are )?welcome\b|dog[- ]friendly/i.test(text)) facilities.push({ key: "dog_friendly", status: "yes", evidence: quote(/[^.\n]*dog[^.\n]*/i) });
  if (/\bvegan\b/i.test(text)) facilities.push({ key: "vegan_options", status: "yes", evidence: quote(/[^.\n]*vegan[^.\n]*/i) });
  return { items, facilities };
}
