/**
 * Threshold block: minimum headcount ("it's on") and maximum with a waitlist.
 * Pure: counting and ordering are done by code, never by a model.
 */

export type ThresholdConfig = { min?: number | null; max?: number | null };
export type RsvpAnswer = { handle: string; response: "in" | "out"; at: string };

export type ThresholdState = {
  /** In and within the cap, in the order they said yes. */
  going: string[];
  /** In, but beyond the cap: waiting for a place, in order. */
  waitlist: string[];
  out: string[];
  /** True when the minimum is reached (or there is no minimum). */
  on: boolean;
};

export function evaluate(answers: RsvpAnswer[], cfg: ThresholdConfig): ThresholdState {
  const ins = answers.filter((a) => a.response === "in").sort((a, b) => a.at.localeCompare(b.at)).map((a) => a.handle);
  const cap = cfg.max && cfg.max > 0 ? cfg.max : Infinity;
  const going = ins.slice(0, cap);
  return {
    going,
    waitlist: ins.slice(cap),
    out: answers.filter((a) => a.response === "out").map((a) => a.handle),
    on: going.length >= (cfg.min ?? 0),
  };
}

/**
 * Neutral event lines describing what a change in answers caused, for the group.
 * `who` is the person who just answered (display name).
 */
export function describeTransition(
  before: ThresholdState,
  after: ThresholdState,
  cfg: ThresholdConfig,
  who: { handle: string; name: string; changed: boolean },
  names: Map<string, string>,
): string[] {
  const lines: string[] = [];
  const name = (h: string) => names.get(h) ?? `@${h}`;
  const wasIn = before.going.includes(who.handle) || before.waitlist.includes(who.handle);
  const position = after.waitlist.indexOf(who.handle);

  const subject = who.changed ? `${who.name} changed their answer:` : who.name;
  if (position >= 0 && !before.waitlist.includes(who.handle)) {
    lines.push(`${subject} is on the waitlist (#${position + 1}) — the plan is full (${cfg.max} max).`);
  } else if (after.going.includes(who.handle) && !wasIn) {
    lines.push(`${subject} is in ✅`);
  } else if (after.out.includes(who.handle)) {
    lines.push(`${subject} can't make it ❌`);
  }

  // People who moved up from the waitlist because a place opened.
  for (const h of after.going) {
    if (before.waitlist.includes(h)) lines.push(`${name(h)} moved up from the waitlist: is in ✅`);
  }

  if (cfg.min) {
    if (!before.on && after.on) lines.push(`It's on! ✅ ${after.going.length} of ${cfg.min} needed are in.`);
    if (before.on && !after.on) lines.push(`Not enough people anymore: ${after.going.length} of ${cfg.min} needed.`);
  }
  return lines;
}
