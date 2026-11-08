/**
 * "How customers book or order": the business's own ways (its booking site,
 * online shop, phone, WhatsApp, email). AGENTME never books or takes orders
 * itself; it sends people to these. Pure (no server code): used by My Business
 * (preview), the business page, the business agent and plans.
 */

export const WAY_KINDS = ["book", "order", "call", "whatsapp", "email", "website"] as const;
export type WayKind = (typeof WAY_KINDS)[number];
export type Way = { kind: WayKind; value: string };
export const MAX_WAYS = 4;

export const KIND_LABEL: Record<WayKind, { icon: string; name: string; hint: string }> = {
  book: { icon: "📅", name: "Book", hint: "Booking page: tables, appointments, classes…" },
  order: { icon: "🛍️", name: "Order", hint: "Online shop, takeaway or delivery page" },
  call: { icon: "📞", name: "Call", hint: "Phone number" },
  whatsapp: { icon: "💬", name: "WhatsApp", hint: "WhatsApp number or wa.me link" },
  email: { icon: "✉️", name: "Email", hint: "Email address" },
  website: { icon: "🔗", name: "Website", hint: "Any other page" },
};

/** Well-known booking/ordering services, recognised from the link. */
const PROVIDERS: [RegExp, string][] = [
  [/(^|\.)opentable\./, "OpenTable"],
  [/(^|\.)resy\.com$/, "Resy"],
  [/(^|\.)thefork\./, "TheFork"],
  [/(^|\.)sevenrooms\.com$/, "SevenRooms"],
  [/(^|\.)designmynight\.com$/, "DesignMyNight"],
  [/(^|\.)fresha\.com$/, "Fresha"],
  [/(^|\.)treatwell\./, "Treatwell"],
  [/(^|\.)booksy\.com$/, "Booksy"],
  [/(^|\.)calendly\.com$/, "Calendly"],
  [/(^|\.)mindbodyonline\.com$/, "Mindbody"],
  [/(^|\.)square\.site$|(^|\.)squareup\.com$/, "Square"],
  [/(^|\.)deliveroo\./, "Deliveroo"],
  [/(^|\.)ubereats\.com$/, "Uber Eats"],
  [/(^|\.)just-eat\.|(^|\.)justeat\./, "Just Eat"],
  [/(^|\.)doordash\.com$/, "DoorDash"],
  [/(^|\.)etsy\.com$/, "Etsy"],
  [/(^|\.)myshopify\.com$/, "Shopify"],
];

export function providerOf(way: Way): string | null {
  if (way.kind === "whatsapp") return "WhatsApp";
  if (way.kind === "call" || way.kind === "email") return null;
  try {
    const host = new URL(way.value).hostname.toLowerCase();
    return PROVIDERS.find(([re]) => re.test(host))?.[1] ?? null;
  } catch {
    return null;
  }
}

const digits = (s: string) => s.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");

/** Checks and tidies what the business typed. Only http(s), tel, wa.me and mailto ever come out. */
export function normaliseWay(kind: string, raw: string): { ok: true; way: Way } | { ok: false; error: string } {
  if (!(WAY_KINDS as readonly string[]).includes(kind)) return { ok: false, error: "Pick what this is." };
  const k = kind as WayKind;
  const value = raw.trim().slice(0, 500);
  if (!value) return { ok: false, error: `Add the ${KIND_LABEL[k].hint.toLowerCase()}.` };
  if (k === "email") {
    return /^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i.test(value) ? { ok: true, way: { kind: k, value: value.toLowerCase() } } : { ok: false, error: "That doesn't look like an email address." };
  }
  if (k === "call" || (k === "whatsapp" && !/^(https?:\/\/)?(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)/i.test(value))) {
    const phone = digits(value);
    if (!/^\+?\d{6,15}$/.test(phone) || !/^[\d\s+().-]+$/.test(value)) return { ok: false, error: "That doesn't look like a phone number." };
    return { ok: true, way: { kind: k, value: k === "call" ? value.replace(/\s+/g, " ") : `https://wa.me/${phone.replace(/^\+/, "")}` } };
  }
  // A link: add https:// when the business typed just the address.
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
  } catch {
    return { ok: false, error: "That doesn't look like a web address." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "Use a web address starting with https://" };
  if (!url.hostname.includes(".") || url.username || url.password) return { ok: false, error: "That doesn't look like a web address." };
  return { ok: true, way: { kind: k, value: url.toString() } };
}

/** Ways stored in business_info, re-checked (never trust stored data blindly). */
export function waysOf(businessInfo: unknown): Way[] {
  const list = ((businessInfo ?? {}) as { ways?: unknown }).ways;
  if (!Array.isArray(list)) return [];
  return list
    .map((w) => (w && typeof w === "object" ? normaliseWay(String((w as Way).kind), String((w as Way).value)) : null))
    .flatMap((r) => (r?.ok ? [r.way] : []))
    .slice(0, MAX_WAYS);
}

export function wayHref(way: Way): string {
  if (way.kind === "call") return `tel:${digits(way.value)}`;
  if (way.kind === "email") return `mailto:${way.value}`;
  return way.value;
}

/** "📅 Book on OpenTable", "📞 Call 020 7946 0000", "🛍️ Order on Deliveroo"… */
export function wayLabel(way: Way): string {
  const { icon, name } = KIND_LABEL[way.kind];
  const provider = providerOf(way);
  if (way.kind === "call") return `${icon} Call ${way.value}`;
  if (way.kind === "email") return `${icon} Email ${way.value}`;
  if (way.kind === "whatsapp") return `${icon} WhatsApp`;
  if (way.kind === "website") return `${icon} ${provider ?? new URL(way.value).hostname.replace(/^www\./, "")}`;
  return provider ? `${icon} ${name} on ${provider}` : `${icon} ${name} online`;
}

/** Plain text for the agent's answers: one line per way, with the address to use. */
export function waysText(ways: Way[]): string {
  return ways.map((w) => (w.kind === "call" || w.kind === "email" ? wayLabel(w) : `${wayLabel(w)}: ${w.value}`)).join("\n");
}

/** Someone wants to book or order (so they get the business's own ways, never a promise). */
export function wantsToBookOrOrder(text: string): boolean {
  return /\b(book|booking|reserve|reservation|table for|appointment|slot|order|takeaway|take-away|delivery|deliver|collect(ion)?|buy|purchase)\b/i.test(text);
}

/**
 * The agent's answer, made reliable for booking/ordering questions: code (not
 * the model) makes sure the business's own ways are in it, and such a question
 * never goes to the team when the ways answer it.
 */
export function withWays(question: string, reply: { answer: string; needs_team: boolean }, ways: Way[]): { answer: string; needs_team: boolean } {
  if (!ways.length || !wantsToBookOrOrder(question)) return reply;
  const missing = ways.filter((w) => !reply.answer.includes(w.value));
  if (reply.needs_team) return { answer: `I can't book or take orders myself, but you can here:\n${waysText(ways)}`, needs_team: false };
  if (!missing.length) return reply;
  return { answer: `${reply.answer.trim()}\n\nTo book or order:\n${waysText(ways)}`, needs_team: false };
}
