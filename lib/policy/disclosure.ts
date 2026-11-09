import { mayShareContactScopedData, type Relationship } from "./contactPolicy";

/**
 * What an agent knows about its owner, by topic. "away" is a temporary part of
 * availability; "custom" is a topic the owner named; "notes" are never shared.
 */
export const FACT_CATEGORIES = ["availability", "away", "food", "interests", "location", "budget", "practical", "custom", "notes"] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];

/** Categories another agent may ever ask for in a coordination request. */
export const REQUESTABLE_CATEGORIES = ["availability", "food", "location", "interests", "budget", "practical"] as const satisfies readonly FactCategory[];
export type RequestableCategory = (typeof REQUESTABLE_CATEGORIES)[number];

export type Fact = {
  category: FactCategory;
  value: string;
  disclosure: "private" | "contacts";
  /** Your own topic's name ("Music I like"); "" for built-in topics. */
  label?: string;
};

export function isRequestableCategory(value: unknown): value is RequestableCategory {
  return typeof value === "string" && (REQUESTABLE_CATEGORIES as readonly string[]).includes(value);
}

/** Which request a fact answers: time away is part of availability, your own topics are part of interests. */
export function requestCategoryOf(category: FactCategory): RequestableCategory | null {
  if (category === "away") return "availability";
  if (category === "custom") return "interests";
  return isRequestableCategory(category) ? category : null;
}

/**
 * Data minimisation BEFORE the LLM: returns only the facts that
 *   1. the owner marked as shareable with contacts,
 *   2. the requesting task explicitly asked for, and
 *   3. may be shared given the sender/recipient relationship.
 *
 * Everything else never enters the responding agent's prompt, so a prompt
 * injection in the request has nothing private to leak.
 */
export function selectDisclosableFacts(
  facts: readonly Fact[],
  requested: readonly unknown[],
  relationship: Relationship,
): Fact[] {
  if (!mayShareContactScopedData(relationship)) return [];
  const wanted = new Set(requested.filter(isRequestableCategory));
  return facts.filter((f) => {
    const answers = requestCategoryOf(f.category);
    return f.disclosure === "contacts" && f.category !== "notes" && answers !== null && wanted.has(answers);
  });
}

/** Shareable facts as one line per requested category ("Away until 20 Dec; weekday evenings…"). */
export function factsByRequest(facts: readonly Fact[]): Partial<Record<RequestableCategory, string>> {
  const out: Partial<Record<RequestableCategory, string[]>> = {};
  for (const f of facts) {
    const c = requestCategoryOf(f.category);
    if (!c) continue;
    (out[c] ??= []).push(f.category === "custom" && f.label ? `${f.label}: ${f.value}` : f.value);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v!.join("; ").slice(0, 600)])) as Partial<Record<RequestableCategory, string>>;
}

/** Labels for UI and approval cards (used inside sentences: "ask for availability and food preferences"). */
export const CATEGORY_LABELS: Record<FactCategory, string> = {
  availability: "Availability",
  away: "Time away",
  food: "Food preferences",
  interests: "Hobbies & interests",
  location: "Where you usually are",
  budget: "Budget for going out",
  practical: "Practical needs",
  custom: "Your own topics",
  notes: "Private notes",
};
