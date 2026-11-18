import { CATEGORY_LABELS, type FactCategory } from "@/lib/policy/disclosure";

/** What another agent asked yours, in plain words (Settings → Activity). */
export type IncomingRow = {
  /** The question, or what a plan request was about. */
  asked: string | null;
  /** A plan request ("dinner, Saturday evening") rather than a question. */
  plan: boolean;
  /** What was said back, when something was. */
  answer: string | null;
  /** For a plan request: exactly which of your details went out. */
  shared: { label: string; value: string }[];
  outcome: Outcome;
  /** Who answered, or why nothing was answered. */
  outcomeText: string;
};

export type Outcome = "waiting" | "you" | "agent" | "none";
export const OUTCOMES: { id: Outcome | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "waiting", label: "Waiting for you" },
  { id: "you", label: "Answered by you" },
  { id: "agent", label: "Answered by your agent" },
];

type Exchange = {
  skill: string;
  status: string;
  answered_by: string | null;
  disclosed_categories: string[];
  request: unknown;
  response: unknown;
  error: string | null;
};

const object = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
/** "@trattoria: do you have a piano?" → "do you have a piano?" (asked in a group, addressed to the business). */
const unaddressed = (value: string | null) => value?.replace(/^@[a-z0-9_]+[:,]?\s+/i, "") || value;
const sentence = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const SHAREABLE: FactCategory[] = ["availability", "food", "location", "interests", "budget", "practical"];

export function describeIncoming(e: Exchange): IncomingRow {
  const request = object(e.request);
  const response = object(e.response);
  const data = object(response.data);
  const plan = e.skill === "coordination.availability";
  const asked = plan
    ? [text(request.event), text(request.window)].filter(Boolean).join(", ") || null
    : unaddressed(text(request.question) ?? text(request.text));
  // Only what was really handed over: the categories logged as shared, with the values sent.
  const shared = plan
    ? SHAREABLE.filter((c) => e.disclosed_categories.includes(c) && text(data[c])).map((c) => ({ label: CATEGORY_LABELS[c], value: text(data[c])! }))
    : [];
  const answer = plan ? (shared.length ? null : text(response.text)) : text(data.answer) ?? text(response.text);

  if (e.status === "waiting_human") {
    return { asked, plan, answer: null, shared: [], outcome: "waiting", outcomeText: "Waiting for you" };
  }
  if (e.status === "completed") {
    if (e.answered_by === "human") return { asked, plan, answer, shared, outcome: "you", outcomeText: "You answered" };
    if (data.type === "agentme.business.handoff_offer") return { asked, plan, answer, shared, outcome: "none", outcomeText: "Your agent didn't know, and offered to ask the team" };
    if (data.type === "agentme.business.redirect") return { asked, plan, answer, shared, outcome: "none", outcomeText: "Not about your business: nothing shared" };
    const source = e.disclosed_categories.includes("business_info")
      ? " · from your public details"
      : e.disclosed_categories.includes("saved_tip")
        ? " · from your saved tips"
        : "";
    return { asked, plan, answer, shared, outcome: "agent", outcomeText: `Your agent answered${source}` };
  }
  if (e.status === "refused" && e.answered_by === "human") return { asked, plan, answer: null, shared: [], outcome: "you", outcomeText: "You chose not to answer" };
  if (e.status === "refused") return { asked, plan, answer: null, shared: [], outcome: "none", outcomeText: e.error ? `Refused: ${sentence(e.error)}` : "Refused" };
  if (e.status === "pending") return { asked, plan, answer: null, shared: [], outcome: "none", outcomeText: "Still in progress" };
  // A technical failure: nothing went out, and the details wouldn't help.
  return { asked, plan, answer: null, shared: [], outcome: "none", outcomeText: "Not answered: something went wrong, nothing shared" };
}
