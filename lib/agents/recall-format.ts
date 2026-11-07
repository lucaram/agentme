/** Recall data shapes and a deterministic formatter (pure; no database access). */

export type RecallPlan = {
  kind: string;
  title: string;
  organiser: string;
  status: string;
  createdAt: string;
  when?: string;
  rsvp?: { in: string[]; out: string[]; waiting: string[]; waitlist?: string[]; min?: number | null };
  assign?: { item: string; by: string | null }[];
  poll?: { question: string; counts: Record<string, number>; closed: boolean; winners: string[]; notVoted: string[] };
  answers?: { handle: string; answer: string | null; status: string }[];
};

/** Deterministic answer used by the mock model (and handy for tests). */
export function describeRecall(text: string, plans: RecallPlan[]): string {
  if (!plans.length) return "You don't have any plans yet.";
  const words = text.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  const plan = plans.find((p) => words.some((w) => p.title.toLowerCase().includes(w))) ?? plans[0];
  const at = (hs: string[]) => (hs.length ? hs.map((h) => `@${h}`).join(", ") : "nobody");
  const parts = [`${plan.title}${plan.when ? `: ${plan.when}` : ""}.`];
  if (plan.rsvp) {
    parts.push(`In: ${at(plan.rsvp.in)}. Can't make it: ${at(plan.rsvp.out)}. Waiting: ${at(plan.rsvp.waiting)}.`);
    if (plan.rsvp.waitlist?.length) parts.push(`Waitlist: ${at(plan.rsvp.waitlist)}.`);
    if (plan.rsvp.min) parts.push(plan.rsvp.in.length >= plan.rsvp.min ? `It's on (${plan.rsvp.in.length} of ${plan.rsvp.min} needed).` : `${plan.rsvp.in.length} of ${plan.rsvp.min} needed so far.`);
  }
  if (plan.assign) {
    parts.push(plan.assign.map((a) => `${a.item}: ${a.by ? `@${a.by}` : "open"}`).join(", ") + ".");
  }
  if (plan.poll) {
    const counts = Object.entries(plan.poll.counts).map(([o, n]) => `${o} ${n}`).join(", ");
    parts.push(`Votes: ${counts}.${plan.poll.closed ? ` Result: ${plan.poll.winners.join(" / ") || "no votes"}.` : ` Not voted yet: ${at(plan.poll.notVoted)}.`}`);
  }
  if (plan.answers) {
    parts.push(plan.answers.map((a) => (a.answer ? `@${a.handle}: “${a.answer}”` : `@${a.handle}: ${a.status === "waiting" ? "no answer yet" : a.status.replace("_", " ")}`)).join(" "));
  }
  return parts.join(" ");
}
