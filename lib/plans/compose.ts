/**
 * The AI composer (V2 / Milestone 4): any request becomes a plan made of
 * building blocks. The model only PROPOSES a composition; code validates and
 * normalises it (participants come from the owner's @mentions, step order must
 * make sense, limits apply) and the organiser can edit it before approving.
 * Pure module: no database access.
 */
import { z } from "zod";
import { displayClock, heuristicIntent, splitList } from "@/lib/coordination/heuristics";
import { CATEGORY_LABELS, REQUESTABLE_CATEGORIES, isRequestableCategory } from "@/lib/policy/disclosure";
import { MAX_PLAN_PEOPLE, type NewStep, type TaskParsed } from "./types";
import { stepWords } from "./wording";

export const COMPOSABLE_STEPS = ["collect", "proposal", "rsvp", "poll", "question", "assign", "announce"] as const;
export type ComposableStep = (typeof COMPOSABLE_STEPS)[number];
export const MAX_STEPS = 5;

/** Flat on purpose: every field present (empty when not used) keeps structured output reliable. */
export const StepDraftSchema = z.object({
  type: z.enum(COMPOSABLE_STEPS),
  event: z.string().max(60).describe("collect/rsvp: short event name, e.g. 'dinner', 'Five-a-side'."),
  window: z.string().max(80).describe("collect: when, in the owner's words ('Saturday evening'). rsvp: the fixed day."),
  categories: z
    .array(z.enum(REQUESTABLE_CATEGORIES))
    .describe("collect: what to ask agents for (availability, food, location, interests, practical, budget). Ask only for what the plan needs."),
  time: z.string().max(5).describe("rsvp: fixed start time, 24h HH:MM."),
  min: z.number().int().min(0).max(MAX_PLAN_PEOPLE).describe("rsvp: minimum people (incl. owner), 0 if none."),
  max: z.number().int().min(0).max(MAX_PLAN_PEOPLE).describe("rsvp: maximum places (incl. owner), 0 if none."),
  question: z.string().max(500).describe("poll: the question. question: what to ask, addressed to the recipient."),
  options: z.array(z.string().max(60)).max(6).describe("poll: 2-6 options exactly as given."),
  items: z.array(z.string().max(80)).max(20).describe("assign: items/roles to claim, exactly as given."),
  message: z.string().max(1000).describe("announce: the exact message to send."),
});
export type StepDraft = z.infer<typeof StepDraftSchema>;

export const ComposeSchema = z.object({
  kind: z.enum(["plan", "chat"]).describe("plan = the owner wants something organised with the mentioned people; chat = anything else."),
  title: z.string().max(80).describe("A short name for the plan."),
  steps: z.array(StepDraftSchema).max(MAX_STEPS),
});
export type PlanDraft = z.infer<typeof ComposeSchema>;

export const emptyStep = (type: ComposableStep): StepDraft => ({
  type,
  event: "",
  window: "",
  categories: [],
  time: "",
  min: 0,
  max: 0,
  question: "",
  options: [],
  items: [],
  message: "",
});

// ---------------------------------------------------------------- deterministic composer

const stripArticle = (s: string) => s.replace(/^(a|an|the|some)\s+/i, "").trim();

/** Used by the mock model and as a fallback when the real model fails. */
export function heuristicCompose(text: string, chatMembers: string[] = []): PlanDraft {
  const intent = heuristicIntent(text, chatMembers);
  if (intent.kind === "chat") return { kind: "chat", title: "", steps: [] };
  const steps: StepDraft[] = [];
  const step = (type: ComposableStep, fields: Partial<StepDraft>) => steps.push({ ...emptyStep(type), ...fields });

  switch (intent.kind) {
    case "coordinate":
      step("collect", { event: intent.event, window: intent.window, categories: intent.categories });
      if (/\bagenda\b/i.test(text)) step("question", { question: "What would you like on the agenda?" });
      break;
    case "rsvp":
      step("rsvp", { event: intent.event, window: intent.window, time: intent.time, min: intent.min, max: intent.max });
      break;
    case "poll":
      step("poll", { question: intent.question, options: intent.options });
      break;
    case "question":
      step("question", { question: intent.question });
      break;
    case "assign":
      step("assign", { items: intent.items, event: intent.event });
      break;
    case "announce":
      step("announce", { message: intent.message });
      break;
  }
  // "...someone bring a ball and bibs" adds a sign-up list to another plan.
  const bring = text.match(/\b(?:someone|somebody|can someone|who can|people)\s+bring\s+([^.;:!?]+)/i)?.[1];
  if (bring && intent.kind !== "assign") {
    const items = splitList(bring.replace(/@[a-z0-9_]+/gi, "")).map(stripArticle).filter(Boolean);
    if (items.length) step("assign", { items });
  }
  const title = intent.kind === "assign" ? intent.event : intent.kind === "poll" || intent.kind === "question" ? intent.question : intent.kind === "announce" ? "Announcement" : intent.event;
  return { kind: "plan", title: title.slice(0, 80), steps };
}

// ---------------------------------------------------------------- validation

export type ValidatedPlan = { steps: NewStep[]; parsed: TaskParsed; preview: string[] };
type Validation = ({ ok: true } & ValidatedPlan) | { ok: false; error: string };

const clean = (list: string[], max: number, len: number) =>
  [...new Map(list.map((s) => s.trim()).filter((s) => s && s.length <= len).map((s) => [s.toLowerCase(), s])).values()].slice(0, max);

/**
 * Turns a draft (from the model or the organiser's edits) into engine steps.
 * Everything that must always hold is enforced here, in code.
 */
export function validateDraft(draft: PlanDraft, ctx: { organiser: string; participants: string[] }): Validation {
  const people = ctx.participants.length + 1;
  if (people > MAX_PLAN_PEOPLE) return { ok: false, error: `A plan can include up to ${MAX_PLAN_PEOPLE} people, including you.` };
  if (!draft.steps.length) return { ok: false, error: "The plan has no steps. Say what you'd like to organise." };
  if (draft.steps.length > MAX_STEPS) return { ok: false, error: `A plan can have at most ${MAX_STEPS} steps.` };
  const types = draft.steps.map((s) => s.type);
  if (new Set(types).size !== types.length) return { ok: false, error: "Each kind of step can appear only once in a plan." };

  // Normalise the order: collect -> (question) -> proposal -> rsvp; a collect always gets a proposal, a proposal an RSVP.
  const ordered: StepDraft[] = [...draft.steps];
  const idx = (t: ComposableStep) => ordered.findIndex((s) => s.type === t);
  if (idx("proposal") >= 0 && (idx("collect") < 0 || idx("collect") > idx("proposal"))) {
    return { ok: false, error: "A proposal needs the agents' availability first (a “collect” step before it)." };
  }
  if (idx("collect") >= 0 && idx("proposal") < 0) {
    const afterCollect = idx("question") > idx("collect") ? idx("question") : idx("collect");
    ordered.splice(afterCollect + 1, 0, emptyStep("proposal"));
  }
  if (idx("proposal") >= 0 && idx("rsvp") < 0) ordered.splice(idx("proposal") + 1, 0, emptyStep("rsvp"));
  if (idx("rsvp") >= 0 && idx("proposal") > idx("rsvp")) return { ok: false, error: "Ask who's in after the plan is proposed, not before." };
  if (ordered.length > MAX_STEPS + 2) return { ok: false, error: `A plan can have at most ${MAX_STEPS} steps.` };

  const title = draft.title.trim().slice(0, 80) || "Plan";
  const parsed: TaskParsed = { kind: "composed", event: title, window: "", participants: ctx.participants, categories: [] };
  const steps: NewStep[] = [];
  const preview: string[] = [];
  const withProposal = idx("proposal") >= 0;

  for (const s of ordered) {
    switch (s.type) {
      case "collect": {
        const categories = [...new Set(["availability", ...s.categories])].filter(isRequestableCategory);
        const window = s.window.trim() || "this week";
        const event = s.event.trim() || title;
        Object.assign(parsed, { event, window, categories });
        steps.push({ type: "collect", config: { categories, participants: ctx.participants } });
        preview.push(`${stepWords.collect(ctx.participants)} ${categories.map((c) => CATEGORY_LABELS[c].toLowerCase()).join(" and ")} for ${event} (${window}). Nothing else is shared.`);
        break;
      }
      case "proposal":
        steps.push({ type: "proposal" });
        preview.push("Draft a plan for you to approve before anyone sees it.");
        break;
      case "rsvp": {
        const min = s.min > 1 ? s.min : 0;
        const max = s.max > 1 ? s.max : 0;
        if (min > people) return { ok: false, error: `You need at least ${min} people but invited ${people} including you.` };
        if (min && max && min > max) return { ok: false, error: `The minimum (${min}) can't be more than the maximum (${max}).` };
        const limits = [min && `at least ${min}`, max && `max ${max}, then a waitlist`].filter(Boolean).join("; ");
        if (withProposal) {
          steps.push({ type: "rsvp", config: { min: min || null, max: max || null } });
          preview.push(`Ask who's in once you share it${limits ? ` (${limits})` : ""}.`);
        } else {
          const time = /^\d{2}:\d{2}$/.test(s.time) ? s.time : "";
          const day = s.window.trim();
          if (!time || !day) return { ok: false, error: "An invitation needs a fixed day and time, e.g. “Thursday at 7pm”." };
          const event = s.event.trim() || title;
          Object.assign(parsed, { event, window: day, time, min, max });
          steps.push({ type: "rsvp", config: { title: event, day, time, min: min || null, max: max || null } });
          preview.push(`${stepWords.invite(ctx.participants)} ${event}, ${day} at ${displayClock(time)}, and ask who's in${limits ? ` (${limits})` : ""}.`);
        }
        break;
      }
      case "poll": {
        const options = clean(s.options, 6, 60);
        const question = s.question.trim().slice(0, 500);
        if (!question || options.length < 2) return { ok: false, error: "A poll needs a question and at least two options." };
        Object.assign(parsed, { question, options });
        steps.push({ type: "poll", config: { question, options, voters: [ctx.organiser, ...ctx.participants] } });
        preview.push(`${stepWords.vote(ctx.participants)}: “${question}” ${options.join(" · ")}. Options can't change once sent.`);
        break;
      }
      case "question": {
        const question = s.question.trim().slice(0, 500);
        if (!question) return { ok: false, error: "What should I ask them?" };
        parsed.question ??= question;
        steps.push({ type: "question", config: { question, participants: ctx.participants } });
        preview.push(`${stepWords.question(ctx.participants)}: “${question}”`);
        break;
      }
      case "assign": {
        const items = clean(s.items, 20, 80);
        if (!items.length) return { ok: false, error: "A sign-up list needs at least one item." };
        const listTitle = s.event.trim() || title;
        Object.assign(parsed, { items });
        steps.push({ type: "assign", config: { title: listTitle, items, people: [ctx.organiser, ...ctx.participants] } });
        preview.push(`Sign-up list: ${items.join(" · ")}. ${stepWords.claim(ctx.participants)}; nobody is assigned anything.`);
        break;
      }
      case "announce": {
        const message = s.message.trim().slice(0, 1000);
        if (!message) return { ok: false, error: "What should the announcement say?" };
        Object.assign(parsed, { message });
        steps.push({ type: "announce", config: { message, participants: ctx.participants } });
        preview.push(`Send your exact words as your own message: “${message}”`);
        break;
      }
    }
  }

  // A single-block plan keeps its familiar kind (for cards, History and Recall).
  const kinds: Record<string, TaskParsed["kind"]> = { collect: "coordinate", rsvp: "rsvp", poll: "poll", question: "question", assign: "assign", announce: "announce" };
  const core = draft.steps.filter((s) => s.type !== "proposal");
  if (core.length === 1) parsed.kind = kinds[core[0].type];
  else if (core.length === 2 && core[0].type === "collect" && core[1].type === "rsvp") parsed.kind = "coordinate";
  return { ok: true, steps, parsed, preview };
}

/** Rebuilds an editable draft from stored steps (for the preview editor). */
export function draftFromSteps(title: string, steps: { type: string; config: unknown }[], parsed: TaskParsed): PlanDraft {
  const out: StepDraft[] = [];
  for (const s of steps) {
    const c = (s.config ?? {}) as Record<string, unknown>;
    const base = emptyStep(s.type as ComposableStep);
    switch (s.type) {
      case "collect":
        out.push({ ...base, event: parsed.event, window: parsed.window, categories: ((c.categories as string[]) ?? []).filter(isRequestableCategory) });
        break;
      case "proposal":
        out.push(base);
        break;
      case "rsvp":
        out.push({ ...base, event: String(c.title ?? ""), window: String(c.day ?? ""), time: String(c.time ?? ""), min: Number(c.min ?? 0), max: Number(c.max ?? 0) });
        break;
      case "poll":
        out.push({ ...base, question: String(c.question ?? ""), options: (c.options as string[]) ?? [] });
        break;
      case "question":
        out.push({ ...base, question: String(c.question ?? "") });
        break;
      case "assign":
        out.push({ ...base, event: String(c.title ?? ""), items: (c.items as string[]) ?? [] });
        break;
      case "announce":
        out.push({ ...base, message: String(c.message ?? "") });
        break;
    }
  }
  return { kind: "plan", title, steps: out };
}
