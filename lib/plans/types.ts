import type { Database } from "@/lib/database.types";
import type { AgentRow } from "@/lib/data/agents";

export type TaskRow = Database["public"]["Tables"]["tasks"]["Row"];
export type StepRow = Database["public"]["Tables"]["plan_steps"]["Row"];
export type ExchangeRow = Database["public"]["Tables"]["task_exchanges"]["Row"];

/** Beta limit: people in one plan, including the organiser. */
export const MAX_PLAN_PEOPLE = 20;

/** What the owner asked for, as understood when the task was created. */
export type TaskParsed = {
  event: string;
  window: string;
  participants: string[];
  categories: string[];
};

/**
 * Building blocks a plan is made of. Milestone 1 implements `collect`
 * (Availability + Preference) and `proposal`; the rest arrive in later milestones.
 */
export type StepType = StepRow["type"] &
  ("collect" | "proposal" | "rsvp" | "poll" | "question" | "recall" | "assign" | "threshold" | "change" | "announce");

export type NewStep = { type: StepType; config?: Record<string, unknown> };

export type StepContext = {
  task: TaskRow;
  step: StepRow;
  organiser: AgentRow;
  parsed: TaskParsed;
  /** Results of earlier steps in this plan, by step type. */
  results: Partial<Record<StepType, unknown>>;
  /** Extends the lease; throws if it was lost (cancelled or taken over). */
  renew: () => Promise<void>;
};

export type StepOutcome =
  | { kind: "done"; result?: unknown }
  /** Blocked on people. The task releases its worker and wakes when someone answers. */
  | { kind: "waiting"; taskStatus: "waiting" | "proposal_ready" }
  | { kind: "failed"; error: string };

export type StepHandler = (ctx: StepContext) => Promise<StepOutcome>;
