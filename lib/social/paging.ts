/**
 * How many messages a chat page shows: the latest 200, and 200 more each
 * time "Show earlier messages" is tapped (?earlier=1, 2, …), up to 2,000.
 * Pure (unit-tested).
 */
export const MESSAGES_PER_PAGE = 200;
export const MAX_MESSAGES_SHOWN = 2000;

export function shownCount(earlier: unknown): number {
  const pages = typeof earlier === "string" && /^\d{1,3}$/.test(earlier) ? Number(earlier) : 0;
  return Math.min(MAX_MESSAGES_SHOWN, MESSAGES_PER_PAGE * (1 + pages));
}
