/** Recall data shapes and a deterministic formatter (pure; no database access). */
import type { Way } from "@/lib/business/booking";
import { reservationDirections } from "@/lib/business/reservations";

export type RecallPlan = {
  id?: string;
  kind: string;
  title: string;
  event?: string;
  organiser: string;
  status: string;
  createdAt: string;
  when?: string;
  venue?: { agent_id: string; handle: string; name: string };
  names?: Record<string, string>;
  reservationWays?: Way[];
  rsvp?: { in: string[]; out: string[]; waiting: string[]; waitlist?: string[]; min?: number | null };
  assign?: { item: string; by: string | null }[];
  poll?: { question: string; counts: Record<string, number>; closed: boolean; winners: string[]; notVoted: string[] };
  answers?: { handle: string; answer: string | null; status: string }[];
};

/** Owner-facing recall, phrased directly from saved facts without a model rewrite. */
export function describeRecall(text: string, plans: RecallPlan[], viewerHandle?: string): string {
  if (!plans.length) return "You don't have any plans yet.";
  const words = text.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  const plan = plans.find((p) => words.some((w) => p.title.toLowerCase().includes(w))) ?? plans[0];
  const at = (hs: string[]) => (hs.length ? hs.map((h) => `@${h}`).join(", ") : "nobody");
  const names = (hs: string[], start = false) => {
    const ordered = [...hs].sort((a, b) => Number(b === viewerHandle) - Number(a === viewerHandle));
    const labels = ordered.map((h) => h === viewerHandle ? "you" : plan.names?.[h] || `@${h}`);
    if (start && ordered[0] === viewerHandle) labels[0] = "You";
    return labels.length < 2 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
  };
  const verb = (hs: string[]) => hs.length === 1 && hs[0] !== viewerHandle ? "is" : "are";
  const subject = plan.venue ? `Your ${plan.event || plan.title} at ${plan.venue.name}` : plan.title;
  const parts = [`${subject}${plan.when ? ` is on ${plan.when}` : ""}.`];
  if (plan.rsvp) {
    const { in: going, out, waiting, waitlist = [] } = plan.rsvp;
    const allIn = going.length > 1 && !out.length && !waiting.length && !waitlist.length;
    parts.push(going.length ? `${names(going, true)} ${verb(going)} ${allIn ? "all in" : "in"}.` : "No one has confirmed yet.");
    if (out.length) parts.push(`${names(out, true)} can't make it.`);
    if (waiting.length) parts.push(`We're still waiting for ${names(waiting)} to reply.`);
    else if (/\b(repl(?:y|ied|ies)|respond(?:ed)?|responses?)\b/i.test(text)) parts.push("Everyone has replied.");
    if (waitlist.length) parts.push(`${names(waitlist, true)} ${verb(waitlist)} on the waitlist.`);
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
  return `${parts.join(" ")}${plan.venue ? `\n\nAGENTME hasn't made a reservation. ${reservationDirections(plan.reservationWays ?? [])}` : ""}`;
}
