import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { asJson } from "@/lib/data/json";
import type { NewStep, StepRow, TaskParsed, TaskRow } from "./types";

/** The dinner-style plan: gather availability & preferences, propose, then RSVP. */
export function coordinationSteps(parsed: TaskParsed): NewStep[] {
  return [
    { type: "collect", config: { categories: parsed.categories, participants: parsed.participants } },
    { type: "proposal" },
    { type: "rsvp" },
  ];
}

/** A poll: everyone (including the organiser) votes on fixed options. */
export function pollSteps(organiser: string, participants: string[], question: string, options: string[]): NewStep[] {
  return [{ type: "poll", config: { question, options, voters: [organiser, ...participants] } }];
}

/** An invitation to a fixed event: who's in (with optional minimum / maximum + waitlist). */
export function rsvpSteps(parsed: TaskParsed): NewStep[] {
  return [
    {
      type: "rsvp",
      config: { title: parsed.event, day: parsed.window, time: parsed.time, min: parsed.min || null, max: parsed.max || null },
    },
  ];
}

/** A sign-up list: everyone claims their own items. */
export function assignSteps(organiser: string, participants: string[], title: string, items: string[]): NewStep[] {
  return [{ type: "assign", config: { title, items, people: [organiser, ...participants] } }];
}

/** An announcement: the organiser's exact words, no reply needed. */
export function announceSteps(participants: string[], message: string): NewStep[] {
  return [{ type: "announce", config: { message, participants } }];
}

/** A question: each person answers personally. */
export function questionSteps(participants: string[], question: string): NewStep[] {
  return [{ type: "question", config: { question, participants } }];
}

export async function createSteps(taskId: string, steps: NewStep[]): Promise<void> {
  const { error } = await adminClient()
    .from("plan_steps")
    .insert(steps.map((s, position) => ({ task_id: taskId, position, type: s.type, config: asJson(s.config ?? {}) })));
  // A concurrent worker may have created them first (unique task_id+position).
  if (error && error.code !== "23505") throw error;
}

/**
 * Steps whose result is what people (or their agents) told the organiser:
 * availability, food, budget and practical needs; personal answers; tips.
 * plan_steps can be read by every member of the group a plan is shared in, so
 * these results are kept in plan_step_private, which only the server reads.
 * The row group members can read holds a marker instead.
 */
export const PRIVATE_RESULT_STEPS: readonly string[] = ["collect", "question", "ask_around"];
export const PRIVATE_RESULT_MARK = { private: true } as const;
export const hasPrivateResult = (type: string) => PRIVATE_RESULT_STEPS.includes(type);

/** For the server's own work: these steps with their real results (null when there is none yet). */
export async function withPrivateResults<T extends { id: string; type: string; result: unknown }>(steps: T[]): Promise<T[]> {
  const ids = steps.filter((s) => hasPrivateResult(s.type)).map((s) => s.id);
  if (!ids.length) return steps;
  const { data } = await adminClient().from("plan_step_private").select("step_id, result").in("step_id", ids);
  const kept = new Map((data ?? []).map((r) => [r.step_id, r.result]));
  return steps.map((s) => (hasPrivateResult(s.type) ? { ...s, result: kept.get(s.id) ?? null } : s));
}

/** The private result of a task's step of this type (e.g. what the agents replied to "collect"), or null. */
export async function privateResultOf(taskId: string, type: string): Promise<unknown> {
  const db = adminClient();
  const { data: step } = await db.from("plan_steps").select("id").eq("task_id", taskId).eq("type", type).maybeSingle();
  if (!step) return null;
  const { data } = await db.from("plan_step_private").select("result").eq("step_id", step.id).maybeSingle();
  return data?.result ?? null;
}

/** Steps of a task (with their real results), creating the default ones for tasks made before plans had steps. */
export async function ensureSteps(task: TaskRow): Promise<StepRow[]> {
  const load = async () =>
    (await adminClient().from("plan_steps").select("*").eq("task_id", task.id).order("position")).data ?? [];
  let steps = await load();
  if (!steps.length) {
    await createSteps(task.id, coordinationSteps(task.parsed as unknown as TaskParsed));
    steps = await load();
  }
  return (await withPrivateResults(steps)) as StepRow[];
}

export async function updateStep(stepId: string, fields: { status?: StepRow["status"]; result?: unknown; config?: unknown }) {
  const db = adminClient();
  let result = fields.result;
  if (result !== undefined) {
    // What people told the organiser goes where only the server reads; the shared row gets a marker.
    const { data: step, error: lookup } = await db.from("plan_steps").select("type").eq("id", stepId).maybeSingle();
    // The type decides where the result may be written. If it can't be read, nothing is written at all:
    // guessing "not private" would put people's replies in the row the whole group can read.
    if (lookup || !step) throw new Error(`Couldn't save the step's result (${lookup?.message ?? "step not found"}).`);
    if (hasPrivateResult(step.type)) {
      if (result === null) await db.from("plan_step_private").delete().eq("step_id", stepId);
      else {
        const { error } = await db.from("plan_step_private").upsert({ step_id: stepId, result: asJson(result) });
        if (error) throw error; // never fall back to the shared row
        result = PRIVATE_RESULT_MARK;
      }
    }
  }
  await db
    .from("plan_steps")
    .update({
      ...(fields.status ? { status: fields.status } : {}),
      ...(result !== undefined ? { result: asJson(result) } : {}),
      ...(fields.config !== undefined ? { config: asJson(fields.config) } : {}),
    })
    .eq("id", stepId);
}
