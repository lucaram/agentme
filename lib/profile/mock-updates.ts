/**
 * The test stand-in for the profile check: a few clear phrasings, compared with what's saved.
 * The real check is the AI (lib/profile/offer.ts); this only has to be deterministic.
 */
import { suggestFact } from "./suggest";
import type { ProfileUpdate } from "./update";

export function mockProfileUpdates(text: string, saved: Record<string, string>, ownTopics: Record<string, string> = {}): ProfileUpdate[] {
  const t = text.trim();
  // "I've just bought a red Fiat 500" with a topic "My car": saved there.
  for (const [name, value] of Object.entries(ownTopics)) {
    const word = name.toLowerCase().replace(/^my\s+/, "").split(/\s+/).pop() ?? "";
    const bought = t.match(/\bi(?:'ve| have)\s+(?:just\s+)?(?:bought|got)\s+(?:a |an )?(.+?)[.!]?$/i);
    if (word && bought && (t.toLowerCase().includes(word) || (word === "car" && /\b(fiat|golf|ford|toyota|bmw|audi)\b/i.test(t)))) {
      return [{ category: "custom", topic: name, action: value ? "replace" : "add", value: bought[1], old: value || null, reason: `You said you've got ${bought[1]}.`, until: null }];
    }
  }
  // "I can't do Saturdays any more" → remove the saved part that mentions Saturdays.
  const cant = t.match(/\bi can(?:'t|not) do (\w+?)s?\b.*\b(any ?more|now)\b/i);
  if (cant) {
    const part = (saved.availability ?? "").split(/;\s*/).find((p) => p.toLowerCase().includes(cant[1].toLowerCase()));
    return part ? [{ category: "availability", topic: null, action: "remove", value: "", old: part, reason: `You said you can't do ${cant[1]}s any more.`, until: null }] : [];
  }
  // "I'm also free on Tuesday and Thursday evenings too"
  const free = t.match(/\bi(?:'m| am)\s+(?:also\s+)?free\s+(?:on\s+)?([^.!?]+?)(?:\s+too)?[.!]?$/i);
  if (free) return [{ category: "availability", topic: null, action: "add", value: free[1].replace(/^\w/, (c) => c.toUpperCase()), old: null, reason: "", until: null }];
  // "I eat fish now" with "vegetarian" saved → replace it.
  if (/\b(eat fish|pescatarian)\b/i.test(t) && /vegetarian/i.test(saved.food ?? "")) {
    return [{ category: "food", topic: null, action: "replace", value: "pescatarian", old: "vegetarian", reason: "You said you eat fish now.", until: null }];
  }
  const simple = suggestFact(t, new Date());
  return simple ? [{ category: simple.category, topic: null, action: "add", value: simple.value, old: null, reason: "", until: simple.until ?? null }] : [];
}
