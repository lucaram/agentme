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

/** Steps of a task, creating the default ones for tasks made before plans had steps. */
export async function ensureSteps(task: TaskRow): Promise<StepRow[]> {
  const load = async () =>
    (await adminClient().from("plan_steps").select("*").eq("task_id", task.id).order("position")).data ?? [];
  let steps = await load();
  if (!steps.length) {
    await createSteps(task.id, coordinationSteps(task.parsed as unknown as TaskParsed));
    steps = await load();
  }
  return steps;
}

export async function updateStep(stepId: string, fields: { status?: StepRow["status"]; result?: unknown; config?: unknown }) {
  await adminClient()
    .from("plan_steps")
    .update({
      ...(fields.status ? { status: fields.status } : {}),
      ...(fields.result !== undefined ? { result: asJson(fields.result) } : {}),
      ...(fields.config !== undefined ? { config: asJson(fields.config) } : {}),
    })
    .eq("id", stepId);
}
