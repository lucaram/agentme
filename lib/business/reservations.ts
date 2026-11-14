import { isReservationWay, normaliseWay, waysOf, type Way, type WayKind } from "./booking";
import { itemKey, learnedOf } from "./learn";

type PublishedSite = { url: string; live_at: string | null; learned: unknown; hidden: readonly string[] };
const text = (value: unknown) => typeof value === "string" ? value : "";
const bookingTopic = /\b(book(?:ing|ings)?|reserv(?:e|ation|ations)|contact|phone|telephone|email)\b/i;

/** Public information only. Owner-supplied details win over the reviewed website. */
export function reservationWays(businessInfo: unknown, site?: PublishedSite | null): Way[] {
  const info = (businessInfo ?? {}) as Record<string, unknown>;
  // Once the owner manages Customer actions, that list is authoritative,
  // including an intentionally empty list. Old FAQs/site data must not restore removed actions.
  if (Array.isArray(info.ways)) return waysOf(info).filter(isReservationWay);
  const found: Way[] = [];
  const add = (kind: WayKind, value: string) => {
    const checked = normaliseWay(kind, value);
    if (checked.ok && !found.some((way) => way.kind === kind)) found.push(checked.way);
  };
  const readLinks = (raw: string) => {
    if (bookingTopic.test(raw)) {
      for (const match of raw.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
        const url = match[0].replace(/[),.;!?]+$/, "");
        const before = raw.slice(Math.max(0, match.index! - 70), match.index);
        const bookingLink = /\b(?:book|reserve|reservations?)\s+(?:online\s+)?(?:at|via|on|here:?)\s*$/i.test(before);
        add(bookingLink ? "book" : "website", url);
      }
    }
  };
  const read = (raw: string) => {
    for (const match of raw.matchAll(/\b(?:call|phone|telephone|tel|ring)(?:\s+(?:us|on|at|number|is))*\s*[:.]?\s*(\+?\d[\d ()+.-]{5,}\d)/gi)) add("call", match[1]);
    for (const match of raw.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)) add("email", match[0]);
    readLinks(raw);
  };
  // Corrections are stronger than the website and older free-text details.
  const suppressed = new Set<WayKind>();
  if (Array.isArray(info.corrections)) for (const correction of info.corrections) {
    if (!correction || typeof correction !== "object") continue;
    const label = text(correction.label);
    const value = text(correction.value);
    const kind = /\b(phone|telephone|call)\b/i.test(label) ? "call" : /\bemail\b/i.test(label) ? "email" : null;
    if (kind) { suppressed.add(kind); add(kind, value); }
    else if (bookingTopic.test(label)) read(`${label}: ${value}`);
  }
  add("call", text(info.phone));
  add("email", text(info.email));
  read(`${text(info.about)}\n${text(info.description)}`);
  if (Array.isArray(info.faqs)) for (const faq of info.faqs) {
    if (faq && typeof faq === "object" && bookingTopic.test(`${text(faq.q)} ${text(faq.a)}`)) read(`${text(faq.q)}\n${text(faq.a)}`);
  }
  if (site?.live_at) {
    const learned = learnedOf(site.learned);
    const hidden = new Set(site.hidden);
    if (!suppressed.has("call") && !hidden.has(itemKey.basic("phone"))) add("call", learned.phone);
    if (!suppressed.has("email") && !hidden.has(itemKey.basic("email"))) add("email", learned.email);
    // Do not scrape hidden facts or customers-only sources back into the answer.
    for (const faq of learned.faqs) if (!hidden.has(itemKey.faq(faq.q)) && bookingTopic.test(faq.q)) {
      // Phone/email come only from their dedicated reviewed fields above.
      readLinks(`${faq.q}\n${faq.a}`);
    }
    if (!found.some((way) => way.kind === "book")) add("website", site.url);
  }
  return found;
}

/** Contact details are shown in the booking buttons, rather than repeated in prose. */
export function reservationDirections(ways: readonly Way[]): string {
  return ways.some((way) => way.kind !== "order")
    ? "To arrange one, use the options below."
    : "No booking contact details are published here yet; check the business's profile for updates.";
}
