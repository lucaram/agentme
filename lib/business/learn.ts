/**
 * What a business agent learned from the business's website: the basics,
 * up to 12 facts customers ask about, and up to 10 ready-made questions &
 * answers, each with the page it came from. The owner reviews it (fix or
 * remove anything) before it goes live. Pure (no server code), unit-tested.
 */
import { z } from "zod";
import { shortUrl } from "./site";

export const LearnedSchema = z.object({
  summary: z.string().max(400).default("").describe("What the business is and does, in 1-2 sentences, from the website."),
  hours: z.string().max(300).default("").describe("Opening hours exactly as the website gives them, or empty."),
  address: z.string().max(200).default("").describe("Address, or empty."),
  phone: z.string().max(40).default("").describe("Phone number, or empty."),
  email: z.string().max(120).default("").describe("Email address, or empty."),
  facts: z
    .array(
      z.object({
        label: z.string().max(60).describe("Short topic, e.g. Prices, Parking, Delivery, Cancellations."),
        value: z.string().max(400).describe("What the website says, copied faithfully."),
        source: z.string().max(2000).default("").describe("The address of the page it came from."),
      }),
    )
    .max(12)
    .default([]),
  faqs: z
    .array(
      z.object({
        q: z.string().max(300).describe("A question customers would likely ask."),
        a: z.string().max(1000).describe("The answer, 1-2 sentences, only from the website."),
        source: z.string().max(2000).default("").describe("The address of the page it came from."),
      }),
    )
    .max(10)
    .default([]),
});
export type Learned = z.infer<typeof LearnedSchema>;

export const EMPTY_LEARNED: Learned = { summary: "", hours: "", address: "", phone: "", email: "", facts: [], faqs: [] };

/** What the model fills in: the same shape without length limits (one long answer shouldn't fail the whole read); clampLearned trims it. */
export const LearnedDraftSchema = z.object({
  summary: z.string().default("").describe("What the business is and does, in 1-2 sentences, from the website."),
  hours: z.string().default("").describe("Opening hours exactly as the website gives them, or empty."),
  address: z.string().default("").describe("Address, or empty."),
  phone: z.string().default("").describe("Phone number, or empty."),
  email: z.string().default("").describe("Email address, or empty."),
  facts: z
    .array(z.object({ label: z.string().describe("Short topic, e.g. Prices, Parking, Delivery, Cancellations."), value: z.string().describe("What the website says, copied faithfully."), source: z.string().default("").describe("The address of the page it came from.") }))
    .default([])
    .describe("Up to 12 specific things customers ask about."),
  faqs: z
    .array(z.object({ q: z.string().describe("A question customers would likely ask."), a: z.string().describe("The answer, 1-2 sentences, only from the website."), source: z.string().default("").describe("The address of the page it came from.") }))
    .default([])
    .describe("Up to 10 questions customers would most likely ask that the website answers."),
});
export type LearnedDraft = z.infer<typeof LearnedDraftSchema>;

/** Trims what the model wrote to the stored limits; drops empty items and sources outside the website. */
export function clampLearned(draft: LearnedDraft, pageUrls: readonly string[]): Learned {
  const known = new Set(pageUrls);
  const source = (s: string) => (known.has(s.trim()) ? s.trim() : "");
  const cut = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);
  const seenFacts = new Set<string>();
  const seenFaqs = new Set<string>();
  return {
    summary: cut(draft.summary, 400),
    hours: cut(draft.hours, 300),
    address: cut(draft.address, 200),
    phone: cut(draft.phone, 40),
    email: cut(draft.email, 120),
    facts: draft.facts
      .map((f) => ({ label: cut(f.label, 60), value: cut(f.value, 400), source: source(f.source) }))
      .filter((f) => f.label && f.value && !seenFacts.has(itemKey.fact(f.label)) && seenFacts.add(itemKey.fact(f.label)))
      .slice(0, 12),
    faqs: draft.faqs
      .map((f) => ({ q: cut(f.q, 300), a: cut(f.a, 1000), source: source(f.source) }))
      .filter((f) => f.q && f.a && !seenFaqs.has(itemKey.faq(f.q)) && seenFaqs.add(itemKey.faq(f.q)))
      .slice(0, 10),
  };
}

/** Reads what's stored (or anything) as a valid Learned. */
export function learnedOf(raw: unknown): Learned {
  const parsed = LearnedSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_LEARNED;
}

export const BASICS = [
  { key: "summary", label: "What you do" },
  { key: "hours", label: "Opening hours" },
  { key: "address", label: "Address" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
] as const;
export type BasicKey = (typeof BASICS)[number]["key"];

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120);

/** A stable key for a learned item (what "remove" and "fix" refer to). */
export const itemKey = {
  basic: (key: BasicKey) => `basic:${key}`,
  fact: (label: string) => `fact:${norm(label)}`,
  faq: (q: string) => `faq:${norm(q)}`,
};

/** A correction the owner made: it beats whatever the website says. */
export type Correction = { label: string; value: string };

/**
 * What the agent answers from (website layer): the reviewed summary, minus
 * removed items. The owner's own words and corrections are a separate,
 * stronger layer (see knowledge.ts).
 */
export function learnedText(learned: Learned, hidden: readonly string[]): string {
  const gone = new Set(hidden);
  const basics = BASICS.filter((b) => learned[b.key] && !gone.has(itemKey.basic(b.key))).map((b) => `${b.label}: ${learned[b.key]}`);
  const facts = learned.facts.filter((f) => !gone.has(itemKey.fact(f.label))).map((f) => `- ${f.label}: ${f.value}${f.source ? ` (${shortUrl(f.source)})` : ""}`);
  const faqs = learned.faqs.filter((f) => !gone.has(itemKey.faq(f.q))).map((f) => `Q: ${f.q}\nA: ${f.a}${f.source ? ` (${shortUrl(f.source)})` : ""}`);
  return [basics.join("\n"), facts.join("\n"), faqs.join("\n\n")].filter(Boolean).join("\n\n");
}

/** How many learned items are in use (for "What your agent knows"). */
export function learnedCount(learned: Learned, hidden: readonly string[]): number {
  const gone = new Set(hidden);
  return (
    BASICS.filter((b) => learned[b.key] && !gone.has(itemKey.basic(b.key))).length +
    learned.facts.filter((f) => !gone.has(itemKey.fact(f.label))).length +
    learned.faqs.filter((f) => !gone.has(itemKey.faq(f.q))).length
  );
}

/** Three questions a customer would likely ask, for "Try it as a customer". */
export function tryQuestions(learned: Learned): string[] {
  const fromSite = learned.faqs.map((f) => f.q);
  const generic = [learned.hours ? "When are you open?" : "", learned.address ? "Where are you?" : "", "What do you offer?"].filter(Boolean);
  return [...new Set([...fromSite, ...generic])].slice(0, 3);
}

/** "📄 trattoria.co.uk/menu · checked today": added by code to answers that came from a website page. */
export function citation(url: string, lastReadAt: string | null | undefined, now = Date.now()): string {
  const when = (() => {
    if (!lastReadAt) return "recently";
    const day = (t: number) => Math.floor(t / 86_400_000);
    const diff = day(now) - day(Date.parse(lastReadAt));
    if (diff <= 0) return "today";
    if (diff === 1) return "yesterday";
    return new Date(lastReadAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  })();
  return `📄 From ${shortUrl(url)} · checked ${when}`;
}

// ------------------------------------------------------------- deterministic stand-ins (tests, no API key)

export type PageText = { url: string; title: string; text: string };

const PRICE = /[£$€]\s?\d/;
const PHONE = /(\+?\d[\d ()-]{8,}\d)/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const HOURS = /\b(open|opening|hours|mon|tue|wed|thu|fri|sat|sun)\w*\b.*\d/i;

/** What the mock "learns": copies lines from the pages, never invents anything. */
export function mockLearn(pages: PageText[]): Learned {
  const lines = pages.flatMap((p) => p.text.split("\n").map((line) => ({ line: line.replace(/^-\s*/, "").trim(), url: p.url }))).filter((l) => l.line);
  const find = (re: RegExp) => lines.find((l) => re.test(l.line));
  const hours = find(HOURS);
  const phone = lines.map((l) => l.line.match(PHONE)?.[1]).find(Boolean) ?? "";
  const email = lines.map((l) => l.line.match(EMAIL)?.[0]).find(Boolean) ?? "";
  const address = find(/\b(street|st\.|road|rd\.|lane|avenue|square|place)\b.*\d|\d+.*\b(street|road|lane|avenue|square|place)\b/i);
  const summary = lines.find((l) => l.line.length >= 40 && !PRICE.test(l.line) && !HOURS.test(l.line) && !l.line.endsWith("?"));
  const facts = lines
    .filter((l) => PRICE.test(l.line))
    .slice(0, 6)
    .map((l) => ({ label: l.line.split(/[:£$€–-]/)[0].trim().slice(0, 60) || "Price", value: l.line.slice(0, 400), source: l.url }));
  const faqs: Learned["faqs"] = [];
  lines.forEach((l, i) => {
    const next = lines[i + 1];
    if (l.line.endsWith("?") && next && !next.line.endsWith("?") && faqs.length < 8) faqs.push({ q: l.line.slice(0, 300), a: next.line.slice(0, 1000), source: l.url });
  });
  if (hours && faqs.length < 10) faqs.push({ q: "When are you open?", a: hours.line, source: hours.url });
  return {
    summary: summary?.line.slice(0, 400) ?? "",
    hours: hours?.line.slice(0, 300) ?? "",
    address: address?.line.slice(0, 200) ?? "",
    phone: phone.slice(0, 40),
    email: email.slice(0, 120),
    facts,
    faqs,
  };
}

/** What the mock says changed on a website. */
export function mockChanges(added: string[], removed: string[]): string {
  if (!added.length && !removed.length) return "NONE";
  if (added.length) return `Your website now says: “${added[0].slice(0, 160)}”.`;
  return `Your website no longer says: “${removed[0].slice(0, 160)}”.`;
}
