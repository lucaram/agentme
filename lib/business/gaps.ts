/**
 * "Questions your website doesn't answer": what customers asked that the
 * agent couldn't answer, grouped by topic ("6 customers asked about
 * parking"), so the business answers once for everyone. Pure, unit-tested.
 */
import { terms } from "./knowledge";

export type AskedQuestion = { id: string; question: string; created_at: string };
export type Gap = { key: string; topic: string; items: AskedQuestion[] };

/** Words that say nothing about what was asked. */
const GENERIC = new Set(
  "time day today tomorrow tonight week weekend thing something anything place good best nice possible okay hello thank thanks question ask way people person someone".split(" "),
);

const topicTerms = (q: string) => [...new Set(terms(q).filter((w) => !GENERIC.has(w)))];

/** Groups questions sharing a topic word; the topic is the word most of them share. Biggest and newest first. */
export function groupQuestions(questions: AskedQuestion[]): Gap[] {
  const parent = questions.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const words = questions.map((q) => topicTerms(q.question));
  const firstWith = new Map<string, number>();
  words.forEach((ws, i) => {
    for (const w of ws) {
      const j = firstWith.get(w);
      if (j === undefined) firstWith.set(w, i);
      else parent[find(i)] = find(j);
    }
  });
  const groups = new Map<number, number[]>();
  questions.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]));
  return [...groups.values()]
    .map((idx) => {
      const counts = new Map<string, number>();
      for (const i of idx) for (const w of words[i]) counts.set(w, (counts.get(w) ?? 0) + 1);
      const stem = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] ?? "";
      const items = idx.map((i) => questions[i]).sort((a, b) => b.created_at.localeCompare(a.created_at));
      return { key: stem || items[0].id, topic: stem ? asTyped(stem, items) : "", items };
    })
    .sort((a, b) => b.items.length - a.items.length || b.items[0].created_at.localeCompare(a.items[0].created_at));
}

/** The topic as customers wrote it ("parking", not the stem "park"): the most common word with that stem. */
function asTyped(stem: string, items: AskedQuestion[]): string {
  const seen = new Map<string, number>();
  for (const item of items) {
    for (const word of item.question.toLowerCase().match(/[\p{L}0-9]{3,}/gu) ?? []) {
      if (terms(word)[0] === stem) seen.set(word, (seen.get(word) ?? 0) + 1);
    }
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? stem;
}

/** "6 customers asked about parking" / "A customer asked: “…”". */
export function gapTitle(gap: Gap): string {
  if (gap.items.length === 1 || !gap.topic) return `${gap.items.length === 1 ? "A customer" : `${gap.items.length} customers`} asked: “${gap.items[0].question}”`;
  return `${gap.items.length} customers asked about ${gap.topic}`;
}
