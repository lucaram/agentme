/**
 * "How customers book or order": the business's own ways (its booking site,
 * online shop, phone, WhatsApp, email). AGENTME never books or takes orders
 * itself; it sends people to these. Pure (no server code): used by My Business
 * (preview), the business page, the business agent and plans.
 */

export const WAY_KINDS = ["book", "order", "call", "whatsapp", "email", "website", "custom"] as const;
export type WayKind = (typeof WAY_KINDS)[number];
export const WAY_PURPOSES = ["book", "order", "contact", "information"] as const;
export type WayPurpose = (typeof WAY_PURPOSES)[number];
export type Way = { kind: WayKind; value: string; label?: string; purpose?: WayPurpose; primary?: boolean };

export const KIND_LABEL: Record<WayKind, { icon: string; name: string; hint: string }> = {
  book: { icon: "📅", name: "Book", hint: "Booking page: tables, appointments, classes…" },
  order: { icon: "🛍️", name: "Order", hint: "Online shop, takeaway or delivery page" },
  call: { icon: "📞", name: "Call", hint: "Phone number" },
  whatsapp: { icon: "💬", name: "WhatsApp", hint: "WhatsApp number or wa.me link" },
  email: { icon: "✉️", name: "Email", hint: "Email address" },
  website: { icon: "🔗", name: "Website", hint: "Any other page" },
  custom: { icon: "↗", name: "Custom", hint: "Web address for this action" },
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
export function normaliseWay(kind: string, raw: string, options: { label?: unknown; purpose?: unknown; primary?: unknown } = {}): { ok: true; way: Way } | { ok: false; error: string } {
  if (!(WAY_KINDS as readonly string[]).includes(kind)) return { ok: false, error: "Pick what this is." };
  const k = kind as WayKind;
  const label = typeof options.label === "string" ? options.label.replace(/\s+/g, " ").trim() : "";
  if (label.length > 60) return { ok: false, error: "Keep the button label to 60 characters." };
  if (k === "custom" && !label) return { ok: false, error: "Give this custom button a label." };
  if (k === "custom" && options.purpose !== undefined && !(WAY_PURPOSES as readonly unknown[]).includes(options.purpose)) return { ok: false, error: "Choose what this custom action is for." };
  const extra = {
    ...(label ? { label } : {}),
    ...(k === "custom" ? { purpose: (options.purpose ?? "information") as WayPurpose } : {}),
    ...(typeof options.primary === "boolean" ? { primary: options.primary } : {}),
  };
  const value = raw.trim().slice(0, 500);
  if (!value) return { ok: false, error: `Add the ${KIND_LABEL[k].hint.toLowerCase()}.` };
  if (k === "email") {
    return /^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i.test(value) ? { ok: true, way: { kind: k, value: value.toLowerCase(), ...extra } } : { ok: false, error: "That doesn't look like an email address." };
  }
  if (k === "call" || (k === "whatsapp" && !/^(https?:\/\/)?(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)/i.test(value))) {
    const phone = digits(value);
    if (!/^\+?\d{6,15}$/.test(phone) || !/^[\d\s+().-]+$/.test(value)) return { ok: false, error: "That doesn't look like a phone number." };
    return { ok: true, way: { kind: k, value: k === "call" ? value.replace(/\s+/g, " ") : `https://wa.me/${phone.replace(/^\+/, "")}`, ...extra } };
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
  return { ok: true, way: { kind: k, value: url.toString(), ...extra } };
}

/** Buttons shown before "More options", and the most that can be ticked "Show first". */
export const MAX_FEATURED = 4;

/**
 * The order customers see: the ones ticked "Show first" (at most four, in your order), then the rest in
 * your order. The first four of these are shown; the others are under "More options".
 */
export function orderedWays(ways: Way[]): Way[] {
  const first = ways.filter((way) => way.primary).slice(0, MAX_FEATURED);
  return [...first, ...ways.filter((way) => !first.includes(way))];
}

/** Ways stored in business_info, re-checked (never trust stored data blindly). */
export function waysOf(businessInfo: unknown): Way[] {
  const list = ((businessInfo ?? {}) as { ways?: unknown }).ways;
  if (!Array.isArray(list)) return [];
  return list
    .map((w) => (w && typeof w === "object" ? normaliseWay(String((w as Way).kind), String((w as Way).value), w) : null))
    .flatMap((r) => (r?.ok ? [r.way] : []));
}

export function wayHref(way: Way): string {
  if (way.kind === "call") return `tel:${digits(way.value)}`;
  if (way.kind === "email") return `mailto:${way.value}`;
  return way.value;
}

/** "📅 Book on OpenTable", "📞 Call 020 7946 0000", "🛍️ Order on Deliveroo"… */
export function wayLabel(way: Way): string {
  const { icon, name } = KIND_LABEL[way.kind];
  if (way.label) return `${icon} ${way.label}`;
  const provider = providerOf(way);
  if (way.kind === "call") return `${icon} Call ${way.value}`;
  if (way.kind === "email") return `${icon} Email ${way.value}`;
  if (way.kind === "whatsapp") return `${icon} WhatsApp`;
  if (way.kind === "website") return `${icon} ${provider ?? new URL(way.value).hostname.replace(/^www\./, "")}`;
  return provider ? `${icon} ${name} on ${provider}` : `${icon} ${name} online`;
}

/** Compact chat buttons; full contact details remain in the destination and tooltip. */
export function shortWayLabel(way: Way): string {
  const { icon, name } = KIND_LABEL[way.kind];
  const label = way.kind === "custom" ? way.label?.trim().split(/\s+/)[0] || "Custom" : way.kind === "whatsapp" ? "Whatsapp" : name;
  return `${icon} ${label}`;
}

/** Plain text for the agent's answers: one line per way, with the address to use. */
export function waysText(ways: Way[]): string {
  return ways.map((w) => `${wayLabel(w)}${w.label || (w.kind !== "call" && w.kind !== "email") ? `: ${w.value}` : ""}${w.kind === "custom" ? ` (${w.purpose})` : ""}`).join("\n");
}

export const isReservationWay = (way: Way) => way.kind !== "order" && (way.kind !== "custom" || way.purpose === "book" || way.purpose === "contact");

const customMatches = (question: string, way: Way) => way.kind === "custom" && (way.label?.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((word) => !["your", "with", "from", "this", "that", "more", "book", "order", "request", "download", "online", "contact", "information"].includes(word)).some((word) => question.toLowerCase().includes(word));

/** Customer action purpose stays explicit, including for custom labels. */
export function waysForQuestion(question: string, ways: Way[]): Way[] {
  const ordering = /\b(order|takeaway|take-away|delivery|deliver|collect(ion)?|buy|purchase)\b/i.test(question);
  const booking = /\b(book|booking|reserve|reservation|table for|appointment|slot)\b/i.test(question);
  return ways.filter((way) => {
    if (way.kind === "custom") return customMatches(question, way) || (way.purpose === "contact") || (booking && way.purpose === "book") || (ordering && way.purpose === "order");
    if (way.kind === "order") return ordering;
    if (way.kind === "book") return booking;
    return true;
  });
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
  if (!ways.length || (!wantsToBookOrOrder(question) && !ways.some((way) => customMatches(question, way)))) return reply;
  // Keep the legacy fallback when a business supplied only one kind of action.
  const relevant = waysForQuestion(question, ways);
  ways = relevant.length ? relevant : ways.filter((way) => way.kind !== "custom");
  if (!ways.length) return reply;
  const missing = ways.filter((w) => !reply.answer.includes(w.value));
  if (reply.needs_team) return { answer: `${wantsToBookOrOrder(question) ? "I can't book or take orders myself, but you can here:" : "You can use the business's published options for this request:"}\n${waysText(ways)}`, needs_team: false };
  if (!missing.length) return reply;
  return { answer: `${reply.answer.trim()}\n\n${wantsToBookOrOrder(question) ? "To book or order:" : "Options for this request:"}\n${waysText(ways)}`, needs_team: false };
}
