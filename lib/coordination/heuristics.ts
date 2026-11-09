/**
 * Pure, deterministic helpers. Used by the mock LLM, as a fallback planner, and
 * by the proposal validator, which must never depend on an LLM.
 */
import { extractMentions } from "@/lib/policy/handles";
import type { CoordinationReply, Intent, Proposal } from "./schemas";

// ---------------------------------------------------------------- clock

/** "7 PM" | "7pm" | "7:30 pm" | "19:00" -> minutes after midnight */
export function parseClock(input: string): number | null {
  const m = input.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i);
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = m[2] ? Number(m[2]) : 0;
  const suffix = m[3]?.toLowerCase().replace(/\./g, "");
  if (minutes > 59 || hours > 23) return null;
  if (suffix === "pm" && hours < 12) hours += 12;
  if (suffix === "am" && hours === 12) hours = 0;
  // A bare small number in an evening context ("after 7") almost always means PM.
  if (!suffix && !m[2] && hours >= 1 && hours <= 11) hours += 12;
  return hours * 60 + minutes;
}

export function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function displayClock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

const TIME = String.raw`(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)`;

export type AvailabilityWindow = { unavailable: boolean; earliest?: number; latest?: number };

export function parseAvailability(text: string | null | undefined): AvailabilityWindow {
  if (!text) return { unavailable: false };
  if (/\b(not available|unavailable|busy|can'?t make|cannot make|away)\b/i.test(text)) {
    return { unavailable: true };
  }
  const out: AvailabilityWindow = { unavailable: false };
  const range = text.match(new RegExp(String.raw`${TIME}\s*(?:-|–|to)\s*${TIME}`, "i"));
  if (range) {
    const end = parseClock(range[2]);
    let start = parseClock(range[1]);
    // "6-9pm": carry the suffix of the end onto the start.
    if (start !== null && end !== null && start > end) start -= 12 * 60;
    if (start !== null) out.earliest = start;
    if (end !== null) out.latest = end;
  }
  const after = text.match(new RegExp(String.raw`\b(?:after|from)\s+${TIME}`, "i"));
  if (after) {
    const t = parseClock(after[1]);
    if (t !== null) out.earliest = t;
  }
  const before = text.match(new RegExp(String.raw`\b(?:before|until|till|by)\s+${TIME}`, "i"));
  if (before) {
    const t = parseClock(before[1]);
    if (t !== null) out.latest = t;
  }
  return out;
}

// ---------------------------------------------------------------- intent

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MEALS = ["dinner", "lunch", "breakfast", "brunch"];

/** `chatMembers`: when used from a chat ("@agent ..."), its members are the participants. */
export function heuristicIntent(text: string, chatMembers: string[] = []): Intent {
  const lower = text.toLowerCase();
  const mentioned = extractMentions(text);
  const participants = mentioned.length ? mentioned : chatMembers;
  const event =
    lower.match(/\b(dinner|lunch|breakfast|brunch|coffee|drinks|meeting|call|walk|game|five-a-side|5-a-side|football|tennis|match|party|movie|cinema|trip|run)\b/)?.[1] ?? "meetup";
  const day = lower.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tonight|tomorrow|this weekend|weekend)\b/)?.[1];
  const part = lower.match(/\b(morning|afternoon|evening|night|lunchtime)\b/)?.[1];
  const window = [day && capitalise(day), part].filter(Boolean).join(" ") || "this week";
  const verbs = /\b(arrange|organi[sz]e|plan|set up|schedule|meet|find a time|get together|catch up)\b/i;
  const base = {
    event,
    window,
    participants,
    categories: (MEALS.includes(event) || event === "drinks" ? ["availability", "food"] : ["availability"]) as Intent["categories"],
    question: "",
    options: [] as string[],
    time: "",
    min: 0,
    max: 0,
    items: [] as string[],
    message: "",
  };
  if (!participants.length) return { ...base, kind: "chat" };
  const withoutMentions = text.replace(/@[a-z0-9_]+/gi, "").replace(/\s+/g, " ").trim();

  // Announce: "Tell @a and @b: the trip is tomorrow" — sent exactly as written.
  if (/^\s*(tell|announce|inform|let\b.*\bknow)\b/i.test(text)) {
    const message =
      (text.includes(":") ? text.slice(text.indexOf(":") + 1) : text.match(/\bthat\s+(.+)$/i)?.[1] ?? withoutMentions.replace(/^\s*(tell|announce|inform)\b/i, ""))
        .trim();
    if (message) return { ...base, kind: "announce", message: message.slice(0, 1000) };
  }

  // Assign: "Ask @a and @b who brings what for Saturday: drinks, dessert, bread"
  if (/\b(who brings|who'?ll bring|who will bring|bring what|sign[- ]?up|who can bring|who does what|who drives)\b/i.test(text)) {
    const items = text.includes(":") ? splitList(text.slice(text.lastIndexOf(":") + 1)).slice(0, 20) : [];
    const title = /\bwho drives\b/i.test(text) ? "Who drives which day" : day ? `Who brings what — ${capitalise(day)}` : "Who brings what";
    if (items.length) return { ...base, kind: "assign", event: title, items };
  }

  // Poll: "vote", "poll", "which ... X or Y", "choose between ..."
  if (/\b(poll|vote|which|choose between|prefer)\b/i.test(text)) {
    const options = pollOptions(text);
    if (options.length >= 2) return { ...base, kind: "poll", question: pollQuestion(text), options };
  }
  // Question: "Ask @marco if/whether/to ..." (but "ask ... to arrange dinner" is coordination)
  const ask = text.match(/\bask\b(?:\s+@[a-z0-9_]+(?:\s*(?:,|and)\s*@[a-z0-9_]+)*)\s*(?:if|whether|:|to)?\s*(.+)$/i);
  if (ask && !verbs.test(ask[1])) return { ...base, kind: "question", question: toQuestion(ask[1]) };

  // A fixed day AND time means the owner already decided: just invite and ask who's in.
  const at = text.match(/\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i)?.[1];
  const clock = at ? parseClock(at) : null;
  const min = Number(text.match(/\b(?:need|at least|minimum(?: of)?)\s+(\d{1,2})\b/i)?.[1] ?? 0);
  const max = Number(text.match(/\b(?:max(?:imum)?(?: of)?|up to|no more than)\s+(\d{1,2})\b/i)?.[1] ?? 0);
  if (clock !== null && day && (verbs.test(text) || event !== "meetup" || /\binvite\b/i.test(text))) {
    return { ...base, kind: "rsvp", event: capitalise(event === "meetup" ? "get-together" : event), time: formatClock(clock), min, max };
  }

  if (verbs.test(text) || event !== "meetup") return { ...base, kind: "coordinate" };
  return { ...base, kind: "chat" };
}

/** "drinks, dessert and bread" -> ["drinks", "dessert", "bread"] */
export function splitList(segment: string): string[] {
  const items = segment
    .split(/\s*,\s*|\s+and\s+|\s*;\s*/i)
    .map((o) => o.replace(/[?.!]+$/, "").trim())
    .filter((o) => o.length >= 1 && o.length <= 80);
  return [...new Map(items.map((o) => [o.toLowerCase(), o])).values()];
}

/** "...vote: Italian, Thai or Indian" / "which day works better, Saturday or Sunday?" */
export function pollOptions(text: string): string[] {
  const clean = text.replace(/@[a-z0-9_]+/gi, "").trim();
  const segment =
    clean.includes(":") ? clean.slice(clean.lastIndexOf(":") + 1)
    : clean.match(/\bbetween\s+(.+)$/i)?.[1]
    ?? clean.match(/\b(?:better|prefer)\s*[,:]?\s+(.+)$/i)?.[1]
    ?? clean.match(/,\s*([^,]+(?:,[^,]+)*\s+or\s+.+)$/i)?.[1]
    ?? "";
  const options = segment
    .split(/\s*,\s*|\s+or\s+|\s+and\s+/i)
    .map((o) => o.replace(/[?.!]+$/, "").trim())
    .filter((o) => o.length >= 1 && o.length <= 60);
  return [...new Map(options.map((o) => [o.toLowerCase(), o])).values()].slice(0, 6);
}

function pollQuestion(text: string): string {
  const which = text.replace(/@[a-z0-9_]+/gi, "").match(/\b(which[^?:,]*)/i)?.[1]?.trim();
  return which ? `${capitalise(which).replace(/\s+/g, " ")}?` : "Which option do you prefer?";
}

/** "he can help me move on Sunday" -> "Can you help me move on Sunday?" */
function toQuestion(raw: string): string {
  let q = raw.trim().replace(/[.!]+$/, "");
  q = q.replace(/^(he|she|they)\s+(can|could|will|would|is|are|has|have)\b/i, (_, __, verb: string) => `${verb} you`);
  q = q.replace(/\b(his|her|their)\b/gi, "your");
  q = capitalise(q);
  return q.endsWith("?") ? q : `${q}?`;
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------- replies

/** Pick the clause of a free-text availability that matches the requested window. */
export function relevantClause(text: string, window: string): string {
  const day = DAYS.find((d) => window.toLowerCase().includes(d));
  const clauses = text.split(/[;\n]|,(?=\s*[A-Z])/).map((c) => c.trim()).filter(Boolean);
  if (day) {
    const hit = clauses.find((c) => c.toLowerCase().includes(day) || c.toLowerCase().includes(day.slice(0, 3)));
    if (hit) return hit;
    const weekend = ["saturday", "sunday"].includes(day);
    const generic = clauses.find((c) => (weekend ? /weekend/i : /weekday/i).test(c));
    if (generic) return generic;
  }
  return clauses[0] ?? text;
}

export function heuristicReply(
  facts: Partial<Record<"availability" | "food" | "location" | "interests" | "budget" | "practical", string>>,
  window: string,
): CoordinationReply {
  const availability = facts.availability ? relevantClause(facts.availability, window) : null;
  const parts = [
    availability && `Availability: ${availability}`,
    facts.food && `Food: ${facts.food}`,
    facts.location && `Area: ${facts.location}`,
    facts.interests && `Interests: ${facts.interests}`,
    facts.budget && `Budget: ${facts.budget}`,
    facts.practical && `Needs: ${facts.practical}`,
  ].filter(Boolean);
  return {
    availability,
    food: facts.food ?? null,
    location: facts.location ?? null,
    interests: facts.interests ?? null,
    budget: facts.budget ?? null,
    practical: facts.practical ?? null,
    summary: parts.length ? parts.join(". ") : "My owner hasn't shared anything for this request.",
  };
}

// ---------------------------------------------------------------- planning

export type ParticipantReply = {
  handle: string;
  availability: string | null;
  food: string | null;
  /** Only when shared and asked for: to choose the activity or place, never to be repeated. */
  interests?: string | null;
  budget?: string | null;
  practical?: string | null;
};

const CUISINES = [
  "italian", "japanese", "sushi", "indian", "thai", "chinese", "mexican", "french", "greek",
  "spanish", "tapas", "lebanese", "korean", "vietnamese", "pizza", "vegetarian", "vegan", "seafood",
];

export function commonCuisine(foods: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const food of foods) {
    if (!food) continue;
    for (const c of CUISINES) if (food.toLowerCase().includes(c)) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [c, n] of counts) {
    if (n > bestCount) [best, bestCount] = [c, n];
  }
  return best ? capitalise(best) : null;
}

function defaultStart(window: string): number {
  const w = window.toLowerCase();
  if (/morning|breakfast/.test(w)) return 10 * 60;
  if (/lunch/.test(w)) return 12 * 60 + 30;
  if (/afternoon/.test(w)) return 15 * 60;
  return 19 * 60;
}

export function heuristicPlan(
  organiser: string,
  replies: ParticipantReply[],
  event: string,
  window: string,
): Proposal {
  const attending = replies.filter((r) => !parseAvailability(r.availability).unavailable);
  const earliest = attending
    .map((r) => parseAvailability(r.availability).earliest)
    .filter((t): t is number => t !== undefined);
  // Start 30 minutes after the latest "available after" time, rounded to :00/:30.
  let start = earliest.length ? Math.max(...earliest) + 30 : defaultStart(window);
  start = Math.ceil(start / 30) * 30;
  const latest = attending
    .map((r) => parseAvailability(r.availability).latest)
    .filter((t): t is number => t !== undefined);
  if (latest.length && start > Math.min(...latest)) start = Math.max(...earliest, 0);

  const day = DAYS.find((d) => window.toLowerCase().includes(d));
  const cuisine = ["dinner", "lunch", "brunch", "breakfast"].includes(event)
    ? commonCuisine(attending.map((r) => r.food))
    : null;
  const handles = [...new Set([organiser, ...attending.map((r) => r.handle)])];
  return {
    title: `${capitalise(event)}${cuisine ? ` — ${cuisine}` : ""}`,
    day: day ? capitalise(day) : window,
    time: formatClock(start),
    cuisine,
    participants: handles,
    rationale: `Earliest time that suits everyone who replied${cuisine ? `, and ${cuisine.toLowerCase()} came up in shared preferences` : ""}.`,
  };
}
