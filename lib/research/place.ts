/**
 * Where a look-up is about, when the question doesn't say: the town from the
 * owner's "Where you usually are". Pure (unit-tested). Only the town ever
 * leaves: never a street, a house number or a postcode.
 */

const STREET =
  /\b(street|st|road|rd|avenue|ave|lane|ln|drive|dr|close|court|ct|square|sq|place|pl|way|terrace|crescent|gardens|row|flat|apartment|apt|floor|unit|house|via|viale|piazza|corso|vicolo|largo|strada|rue|calle|strasse|straße)\b\.?/i;

/**
 * Folded for comparing place names: "Sant'Angelo", "sant angelo" and
 * "SANT’ANGELO" are the same. Letters of every script are KEPT (only accents,
 * case and punctuation are folded away): dropping what isn't a-z would make
 * "Falkirk サラの家に滞在" look like "Falkirk".
 */
export const placeKey = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * The town in what someone wrote as their usual place, and nothing else of it.
 * "Where you usually are" is free text ("Falkirk, staying with Sarah"), so
 * cleaning it up isn't enough: whatever the person added would go out with a
 * search. Only a part that IS a town we know (`knownTown`: looks it up in the
 * list of towns shipped with the app) is ever used, and what comes back is
 * the name as the LIST writes it, never the person's own text:
 *   "12 High Street, Falkirk FK1 1AA" → "Falkirk"
 *   "Falkirk, staying with Sarah"     → "Falkirk"
 *   "Lives in Islington"              → "Islington"
 *   "at my sister's most weeks"       → null (the agent asks which place)
 */
export function townOf(value: string, knownTown: (name: string) => string | null): string | null {
  const parts = value
    .replace(/\s+/g, " ")
    .split(/[,;\n/]|\s[-–—]\s/)
    .map((p) =>
      p
        // UK-style postcodes and other codes written after a town: "Falkirk FK1 1AA" → "Falkirk"
        .replace(/\b[A-Z]{1,2}\d[A-Z\d]?(\s*\d[A-Z]{2})?\b/g, " ")
        // "Lives in Islington", "I'm usually near Leith", "based around the Shore" → the place itself
        .replace(/^(\s*(i['’]?m|we['’]?re|i|we|he|she|they|am|are|is|usually|mostly|often|live|lives|living|work|works|working|based|stay|stays|around|near|close to|just outside|outside|in|at|by|the)\b)+\s*/i, "")
        .replace(/[.()]/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((p) => p.length >= 2 && p.length <= 60 && !/\d/.test(p) && !STREET.test(p));
  // The first part that is a known town, whole (never a part of a part, never a second part), as the list names it.
  for (const p of parts) {
    const town = knownTown(p);
    if (town) return town;
  }
  return null;
}

const DEPENDS_ON_PLACE =
  /\b(weather|forecast|temperature|rain(ing)?|snow(ing)?|sunny|meteo|near me|nearby|near here|around here|round here|close to me|in my area|my area|locally|local (news|events?|shops?|restaurants?|pubs?|cafes?|plumbers?|electricians?)|vicino a me|qui vicino|in zona|dalle mie parti)\b/i;

/** Does the answer depend on where the person is? (Weather, "near me", local things.) */
export function dependsOnPlace(text: string): boolean {
  return DEPENDS_ON_PLACE.test(text);
}

/** The question with the place it's about, for the search. */
export function withPlace(question: string, town: string): string {
  const q = question.trim().replace(/\b(near me|nearby|near here|around here|round here|close to me|in my area|locally)\b/gi, `near ${town}`);
  return q.toLowerCase().includes(town.toLowerCase()) ? q : `${q.replace(/[?.!]+$/, "")} in ${town}?`;
}

/** Shown with the answer, so a wrong assumption is visible. */
export const placeNote = (town: string, now = false) => `📍 For ${town}, where you ${now ? "are now" : "usually are"}.`;

/** No place named and none saved (or the owner turned this off). */
export const WHICH_PLACE =
  "Which place do you mean? Tell me the town, or save where you usually are in Settings → What your agent knows (start it with the town's name, e.g. “Falkirk”) and I'll use it when you don't say.";
