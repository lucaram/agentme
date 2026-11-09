/**
 * "I'm vegetarian now" → offer to save it to your profile (you confirm; it's
 * never saved silently). Deterministic patterns, so it only offers things it
 * clearly understood. Pure (no server code), unit-tested.
 */
import type { FactCategory } from "@/lib/policy/disclosure";

export type FactSuggestion = {
  category: Extract<FactCategory, "food" | "interests" | "location" | "practical" | "away">;
  /** What gets added (or, for "away", the whole entry). */
  value: string;
  /** For "away": the last day (YYYY-MM-DD). */
  until?: string;
  /** How it's offered: "Save “vegetarian” to Food & drink?" */
  topic: string;
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DIETS = /\b(vegetarian|vegan|pescatarian|gluten[- ]free|dairy[- ]free|lactose[- ]intolerant|halal|kosher|teetotal)\b/i;

/** "20 Dec", "December 20th", "20/12" → the next such date (YYYY-MM-DD), or null. */
export function parseUntil(text: string, today: Date): string | null {
  const t = text.toLowerCase();
  let day: number | null = null;
  let month: number | null = null;
  const dm = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\b/);
  const md = t.match(/\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  const numeric = t.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (dm && MONTHS.includes(dm[2].slice(0, 3))) [day, month] = [Number(dm[1]), MONTHS.indexOf(dm[2].slice(0, 3))];
  else if (md && MONTHS.includes(md[1].slice(0, 3))) [day, month] = [Number(md[2]), MONTHS.indexOf(md[1].slice(0, 3))];
  else if (numeric) [day, month] = [Number(numeric[1]), Number(numeric[2]) - 1];
  if (day === null || month === null || month < 0 || month > 11 || day < 1 || day > 31) return null;
  let year = today.getUTCFullYear();
  const candidate = (y: number) => new Date(Date.UTC(y, month!, day!));
  if (candidate(year).getTime() < Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) year += 1;
  const d = candidate(year);
  if (d.getUTCDate() !== day) return null; // e.g. 31 Feb
  return d.toISOString().slice(0, 10);
}

const tidy = (s: string) => s.trim().replace(/\s+/g, " ").replace(/[.!,;]+$/, "");

export function suggestFact(text: string, today: Date): FactSuggestion | null {
  const t = text.trim();
  if (!t || t.length > 300 || /\?\s*$/.test(t) || /@\w/.test(t)) return null; // questions and requests to others aren't facts

  const away = t.match(/\b(?:i'?m|i am|i'll be|i will be)\s+(?:away|on holiday|travelling|traveling|abroad|off)\b[^.?!]*?\b(?:until|till|til|to)\s+([^.?!]+)/i);
  if (away) {
    const until = parseUntil(away[1], today);
    if (until) {
      const label = new Date(`${until}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
      return { category: "away", until, value: `Away until ${label}: not available for plans before then.`, topic: "When you're free (time away)" };
    }
  }

  const diet = t.match(/\b(?:i'?m|i am|i've gone|i have gone|i went|i'm now|i am now)\s+(?:now\s+|a\s+)?([a-z -]+)/i);
  if (diet && DIETS.test(diet[1])) return { category: "food", value: diet[1].match(DIETS)![1].toLowerCase(), topic: "Food & drink" };
  const allergy = t.match(/\bi'?m allergic to ([a-z ,-]{3,40})/i) ?? t.match(/\bi am allergic to ([a-z ,-]{3,40})/i);
  if (allergy) return { category: "practical", value: `Allergic to ${tidy(allergy[1])}`, topic: "Practical (private)" };
  if (/\bi (?:don'?t|do not) drink\b/i.test(t)) return { category: "practical", value: "Doesn't drink alcohol", topic: "Practical (private)" };
  if (/\bi (?:don'?t|do not) have a car\b|\bi have no car\b/i.test(t)) return { category: "practical", value: "No car", topic: "Practical (private)" };
  const has = t.match(/\bi (?:have|'ve got|have got) (a dog|a cat|kids|two kids|three kids|a baby|a toddler|\w+ children)\b/i);
  if (has) return { category: "practical", value: `Has ${tidy(has[1]).replace(/^a /i, "a ")}`, topic: "Practical (private)" };

  // Case-sensitive on purpose: a place name starts with a capital.
  const live = t.match(/\b[Ii](?: live| am based|'m based| moved) (?:in|to) ([A-Z][\w' -]{1,40})/);
  if (live) return { category: "location", value: tidy(live[1]), topic: "Where you usually are (private)" };

  const hobby = t.match(/\b(?:i (?:love|enjoy|play|do|go)|my hobbies are|my hobby is|i'm into|i am into)\s+([a-z][a-z ,&'-]{2,50})/i);
  if (hobby) {
    const value = tidy(hobby[1]).replace(/^(the|a|an)\s+/i, "");
    if (value.split(" ").length <= 5 && !/\b(you|it|that|this|them|to)\b/i.test(value)) return { category: "interests", value, topic: "Hobbies & interests" };
  }
  return null;
}
