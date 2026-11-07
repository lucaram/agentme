import { mayShareContactScopedData, type Relationship } from "./contactPolicy";

export const FACT_CATEGORIES = ["availability", "food", "location", "notes"] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];

/** Categories another agent may ever ask for in a coordination request. */
export const REQUESTABLE_CATEGORIES = ["availability", "food", "location"] as const satisfies readonly FactCategory[];
export type RequestableCategory = (typeof REQUESTABLE_CATEGORIES)[number];

export type Fact = {
  category: FactCategory;
  value: string;
  disclosure: "private" | "contacts";
};

export function isRequestableCategory(value: unknown): value is RequestableCategory {
  return typeof value === "string" && (REQUESTABLE_CATEGORIES as readonly string[]).includes(value);
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
  return facts.filter((f) => f.disclosure === "contacts" && wanted.has(f.category as RequestableCategory));
}

/** Labels for UI and approval cards. */
export const CATEGORY_LABELS: Record<FactCategory, string> = {
  availability: "Availability",
  food: "Food preferences",
  location: "General area",
  notes: "Private notes",
};
