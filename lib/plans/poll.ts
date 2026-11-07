/**
 * Poll logic. Pure: counting is done by code, never by a model.
 */

export type PollConfig = {
  question: string;
  options: string[];
  /** Handles (no @) allowed to vote, including the organiser. */
  voters: string[];
};

export type PollResult = {
  counts: Record<string, number>;
  winners: string[];
  votes: number;
  voters: number;
};

export function tally(options: string[], votes: string[], voterCount: number): PollResult {
  const counts = Object.fromEntries(options.map((o) => [o, 0]));
  for (const v of votes) if (v in counts) counts[v] += 1;
  const max = Math.max(0, ...Object.values(counts));
  return {
    counts,
    winners: max > 0 ? options.filter((o) => counts[o] === max) : [],
    votes: votes.filter((v) => v in counts).length,
    voters: voterCount,
  };
}

export function describeResult(question: string, r: PollResult): string {
  if (!r.winners.length) return `Poll closed: “${question}” — no votes.`;
  const n = r.counts[r.winners[0]];
  const tally = `${n} of ${r.votes} vote${r.votes === 1 ? "" : "s"}`;
  return r.winners.length === 1
    ? `Poll closed: “${question}” — ${r.winners[0]} (${tally}).`
    : `Poll closed: “${question}” — tie between ${r.winners.join(" and ")} (${tally} each).`;
}

/**
 * What the voter's own agent would suggest, from the voter's OWN preferences
 * (never anyone else's). Only a suggestion: the human always casts the vote.
 * Returns an option only when exactly one option matches a known preference
 * and the matching preference doesn't rule it out.
 */
export function suggestVote(options: string[], facts: { category: string; value: string }[]): { option: string; because: string } | null {
  const hits: { option: string; because: string }[] = [];
  for (const option of options) {
    const word = option.toLowerCase().replace(/s$/, "");
    if (word.length < 3) continue;
    for (const fact of facts) {
      if (fact.category === "notes") continue;
      const value = fact.value.toLowerCase();
      const at = value.indexOf(word);
      if (at < 0) continue;
      // "no seafood", "not Saturday" rule an option out rather than in.
      if (/\b(no|not|never|except|without|hate|dislike)\b[^,;.]*$/.test(value.slice(0, at))) continue;
      hits.push({ option, because: fact.category === "food" ? "your food preferences" : fact.category === "availability" ? "your availability" : "your preferences" });
      break;
    }
  }
  return hits.length === 1 ? hits[0] : null;
}
