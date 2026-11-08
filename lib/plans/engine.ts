import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { LLMError } from "@/lib/llm";
import { getAgentById } from "@/lib/data/agents";
import { postMessage } from "@/lib/data/chat";
import { withUsageContext } from "@/lib/usage/context";
import { ensureSteps, updateStep } from "./steps";
import { runCollect, type CollectConfig } from "./blocks/collect";
import { runProposal } from "./blocks/proposal";
import { runRsvp } from "./blocks/rsvp";
import { runPoll } from "./blocks/poll";
import { runQuestion } from "./blocks/question";
import { runAssign } from "./blocks/assign";
import { runAnnounce } from "./blocks/announce";
import { runAskAround } from "./blocks/askAround";
import type { StepHandler, StepType, TaskParsed, TaskRow } from "./types";

// ------------------------------------------------------------- the plan engine
//
// A plan is an ordered list of steps (blocks). The engine runs them in order:
//  - only the worker holding the task's lease may advance it (Postgres
//    claim_task); if the server dies, the lease expires and the sweeper resumes;
//  - a step can finish, fail, or WAIT for people (inbox answers, organiser
//    approval). Waiting releases the worker; the task is woken when someone
//    answers and re-runs from the first unfinished step;
//  - handlers are idempotent: they reuse what earlier runs already did.

const LEASE_SECONDS = 180;
export const MAX_ATTEMPTS = 3;
/** A freshly approved/woken task gets this long to be claimed before the sweeper steps in. */
const UNCLAIMED_GRACE_MS = 30_000;

const HANDLERS: Partial<Record<StepType, StepHandler>> = {
  collect: runCollect,
  proposal: runProposal,
  rsvp: runRsvp,
  poll: runPoll,
  question: runQuestion,
  assign: runAssign,
  announce: runAnnounce,
  ask_around: runAskAround,
};

class LeaseLost extends Error {}

function errorText(error: unknown) {
  if (error instanceof LLMError) return error.message;
  return error instanceof Error ? error.message : "Something went wrong.";
}

/** Claims the task and runs it as far as it can go. Safe to call concurrently. */
export async function runTask(taskId: string) {
  const { data } = await adminClient().rpc("claim_task", { p_task: taskId, p_lease_seconds: LEASE_SECONDS });
  const task = data?.[0];
  if (!task) return; // not running, or another worker holds a live lease
  await withUsageContext({ taskId, agentId: task.initiator_agent, userId: task.owner_id }, () => executeTask(task));
}

/** Resumes running tasks whose worker disappeared. Returns how many were picked up. */
export async function recoverStuckTasks(): Promise<number> {
  const now = new Date().toISOString();
  const grace = new Date(Date.now() - UNCLAIMED_GRACE_MS).toISOString();
  const { data } = await adminClient()
    .from("tasks")
    .select("id")
    .eq("status", "running")
    .or(`lease_until.lt.${now},and(lease_until.is.null,updated_at.lt.${grace})`)
    .limit(20);
  const ids = (data ?? []).map((t) => t.id);
  await Promise.allSettled(ids.map((id) => runTask(id)));
  return ids.length;
}

/**
 * Moves a task that was waiting on people back to "running" (someone answered).
 * Returns true if the caller should now run it (e.g. with `after(() => runTask(id))`);
 * if nobody does, the sweeper picks it up within a minute.
 */
export async function wakeTask(taskId: string): Promise<boolean> {
  const db = adminClient();
  const { data } = await db
    .from("tasks")
    .update({ status: "running", lease_until: null, wake_requested: false })
    .eq("id", taskId)
    .eq("status", "waiting")
    .select("id");
  if (data?.length) return true;
  // A worker is running it right now: ask it to take another pass before parking.
  await db.from("tasks").update({ wake_requested: true }).eq("id", taskId).eq("status", "running");
  return false;
}

/** Organiser: stop waiting for people who haven't answered and continue with those who did. */
export async function continueWithoutWaiting(taskId: string, userId: string): Promise<boolean> {
  const db = adminClient();
  const { data: task } = await db.from("tasks").select("owner_id, status").eq("id", taskId).maybeSingle();
  if (!task || task.owner_id !== userId || task.status !== "waiting") return false;
  const { data: steps } = await db
    .from("plan_steps")
    .select("id, config")
    .eq("task_id", taskId)
    .in("type", ["collect", "question", "ask_around"])
    .eq("status", "waiting");
  for (const step of steps ?? []) {
    await updateStep(step.id, { config: { ...(step.config as CollectConfig), proceedWithoutWaiting: true } });
  }
  return wakeTask(taskId);
}

async function executeTask(task: TaskRow) {
  const db = adminClient();
  const taskId = task.id;
  const token = task.lease_token!;
  const parsed = task.parsed as unknown as TaskParsed;

  /** Status change that only succeeds while we still hold the lease. */
  const release = async (status: "waiting" | "proposal_ready" | "accepted" | "completed" | "failed", error?: string) => {
    const { data } = await db
      .from("tasks")
      .update({ status, error: error ?? null, lease_until: null })
      .eq("id", taskId)
      .eq("status", "running")
      .eq("lease_token", token)
      .select("id");
    return Boolean(data?.length);
  };
  const renew = async () => {
    const { data } = await db.rpc("renew_task_lease", { p_task: taskId, p_token: token, p_lease_seconds: LEASE_SECONDS });
    if (!data) throw new LeaseLost(); // cancelled by the owner, or taken over
  };
  const fail = async (message: string) => {
    if (await release("failed", message)) {
      await postMessage({
        conversationId: task.conversation_id,
        from: "agent",
        agentId: task.initiator_agent,
        content: `I couldn't finish: ${message}`,
        metadata: { kind: "error", task_id: taskId },
      });
    }
  };

  if (task.attempts > MAX_ATTEMPTS) {
    return fail("I was interrupted several times, so I stopped. Nothing was booked or shared beyond what's shown here. You can ask me again.");
  }

  try {
    const organiser = await getAgentById(task.initiator_agent);
    if (!organiser) return fail("your agent no longer exists.");

    /**
     * One pass over the steps. Returns "parked" when waiting on people, "again" if
     * someone answered while we were running (take another pass), or "finished".
     */
    const runPass = async (): Promise<"parked" | "again" | "finished" | "failed"> => {
      // Cleared before reading any state: a wake after this point is never missed.
      await db.from("tasks").update({ wake_requested: false }).eq("id", taskId).eq("lease_token", token);
      const steps = await ensureSteps(task);
      const results: Partial<Record<StepType, unknown>> = {};
      for (const step of steps) {
        if (step.status === "done" || step.status === "skipped") {
          results[step.type as StepType] = step.result;
          continue;
        }
        const handler = HANDLERS[step.type as StepType];
        if (!handler) {
          await fail(`this plan uses a step I can't run yet (${step.type}).`);
          return "failed";
        }

        await renew();
        const outcome = await handler({ task, step, organiser, parsed, results, renew });
        if (outcome.kind === "done") {
          await updateStep(step.id, { status: "done", result: outcome.result ?? null });
          results[step.type as StepType] = outcome.result;
          continue;
        }
        if (outcome.kind === "failed") {
          await updateStep(step.id, { status: "failed" });
          await fail(outcome.error);
          return "failed";
        }
        // Waiting on people. Don't overwrite a step someone finished meanwhile (e.g. a poll just closed).
        await db.from("plan_steps").update({ status: "waiting" }).eq("id", step.id).neq("status", "done");
        // Park only if nobody answered while we were running.
        const { data: parked } = await db
          .from("tasks")
          .update({ status: outcome.taskStatus, error: null, lease_until: null })
          .eq("id", taskId)
          .eq("status", "running")
          .eq("lease_token", token)
          .eq("wake_requested", false)
          .select("id");
        return parked?.length ? "parked" : "again";
      }
      // A plan built around a proposal ends "accepted" (shared); others simply complete.
      await release(steps.some((s) => s.type === "proposal" || s.type === "rsvp") ? "accepted" : "completed");
      return "finished";
    };

    for (let pass = 0; pass < 5; pass++) {
      if ((await runPass()) !== "again") return;
      await renew();
    }
    // Still being woken after several passes: park and let the next wake or the sweeper continue.
    await release("waiting");
  } catch (error) {
    if (error instanceof LeaseLost) return; // cancelled or taken over: stop quietly
    await fail(errorText(error));
  }
}
