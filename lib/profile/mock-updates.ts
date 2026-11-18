/**
 * The test stand-in for the profile check: a few clear phrasings, compared with what's saved.
 * The real check is the AI (lib/profile/offer.ts); this only has to be deterministic.
 */
import { suggestFact } from "./suggest";
import type { ProfileUpdate } from "./update";

export function mockProfileUpdates(text: string, saved: Record<string, string>): ProfileUpdate[] {
  const t = text.trim();
  // "I can't do Saturdays any more" → remove the saved part that mentions Saturdays.
  const cant = t.match(/\bi can(?:'t|not) do (\w+?)s?\b.*\b(any ?more|now)\b/i);
  if (cant) {
    const part = (saved.availability ?? "").split(/;\s*/).find((p) => p.toLowerCase().includes(cant[1].toLowerCase()));
    return part ? [{ category: "availability", action: "remove", value: "", old: part, reason: `You said you can't do ${cant[1]}s any more.`, until: null }] : [];
  }
  // "I'm also free on Tuesday and Thursday evenings too"
  const free = t.match(/\bi(?:'m| am)\s+(?:also\s+)?free\s+(?:on\s+)?([^.!?]+?)(?:\s+too)?[.!]?$/i);
  if (free) return [{ category: "availability", action: "add", value: free[1].replace(/^\w/, (c) => c.toUpperCase()), old: null, reason: "", until: null }];
  // "I eat fish now" with "vegetarian" saved → replace it.
  if (/\b(eat fish|pescatarian)\b/i.test(t) && /vegetarian/i.test(saved.food ?? "")) {
    return [{ category: "food", action: "replace", value: "pescatarian", old: "vegetarian", reason: "You said you eat fish now.", until: null }];
  }
  const simple = suggestFact(t, new Date());
  return simple ? [{ category: simple.category, action: "add", value: simple.value, old: null, reason: "", until: simple.until ?? null }] : [];
}
