/**
 * "Ask around": asking your contacts for recommendations. Pure helpers (no
 * server code) so they can be unit-tested and used anywhere.
 */

const MENTION = /@([a-z0-9_]{3,20})\b/gi;

/**
 * Recognises a request to ask around:
 *   "ask around: does anyone know a good plumber in Camden?"
 *   "Does anyone know a good dentist?"   "Can anyone recommend a hotel in Lisbon?"
 *   "Any recommendations for a babysitter?"   "Who can lend me a drill?"
 * Optional @mentions narrow it to those people.
 */
export function parseAskAround(text: string): { question: string; mentions: string[] } | null {
  const t = text.trim();
  const explicit = t.match(/^ask (?:around|my (?:friends|contacts))\b[\s,:-]*([\s\S]+)$/i);
  const natural = /^(?:does|do|can|could|would) any(?:one|body)\b|^any (?:recommendations?|tips|suggestions)\b|^who (?:can|could) (?:lend|recommend|suggest)\b|^anyone (?:know|have|recommend)\b/i.test(t);
  if (!explicit && !natural) return null;
  const mentions = [...new Set([...t.matchAll(MENTION)].map((m) => m[1].toLowerCase()))];
  let question = (explicit ? explicit[1] : t).replace(MENTION, "").replace(/^[\s,:;-]*(?:and\b)?[\s,:;-]*/i, "").replace(/\s{2,}/g, " ").trim();
  if (question.length < 3) return null;
  question = question[0].toUpperCase() + question.slice(1);
  if (!/[?.!]$/.test(question)) question += "?";
  return { question: question.slice(0, 300), mentions };
}

const STOP = new Set(["anyone", "anybody", "know", "does", "good", "great", "best", "recommend", "recommendation", "recommendations", "need", "looking", "with", "from", "that", "this", "have", "near", "about", "some", "tips", "would", "could", "your", "there", "where", "which", "what", "lend", "suggest"]);

/** Meaningful words, lightly stemmed ("plumbers" / "plumbing" -> "plumb"). */
function words(text: string): string[] {
  return (text.toLowerCase().match(/\p{L}{4,}/gu) ?? []).filter((w) => !STOP.has(w)).map((w) => w.slice(0, 5));
}

/** Saved tips whose topic matches the question (e.g. topic "plumber" for "good plumbing firm?"). */
export function matchTips<T extends { topic: string }>(question: string, tips: T[]): T[] {
  const asked = new Set(words(question));
  return tips.filter((tip) => words(tip.topic).some((w) => asked.has(w)));
}
