import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { isMember, postMessage } from "@/lib/data/chat";
import type { AgentRow } from "@/lib/data/agents";
import { describeResult, tally, type PollConfig } from "./poll";
import { wakeTask } from "./engine";

type Result = { ok: true; wake?: string | null } | { ok: false; error: string };

async function loadStep(stepId: string) {
  const { data } = await adminClient().from("plan_steps").select("*, tasks(*)").eq("id", stepId).maybeSingle();
  return data;
}

/** Everyone a step's plan includes (organiser + participants), as handles. */
async function planHandles(task: { initiator_agent: string; parsed: unknown }): Promise<string[]> {
  const { data: organiser } = await adminClient().from("agents").select("handle").eq("id", task.initiator_agent).single();
  const parsed = task.parsed as { participants?: string[] };
  return [...new Set([organiser?.handle ?? "", ...(parsed.participants ?? [])])].filter(Boolean);
}

/**
 * RSVP v2: "in" or "out", always the person's own action, changeable at any
 * time. Each change is announced as a neutral event line in the group.
 */
export async function respondRsvp(stepId: string, userId: string, agent: AgentRow, response: "in" | "out"): Promise<Result> {
  const step = await loadStep(stepId);
  const task = step?.tasks;
  if (!step || !task || step.type !== "rsvp" || !task.group_conversation_id) return { ok: false, error: "Not found." };
  if (!(await isMember(task.group_conversation_id, userId))) return { ok: false, error: "Not found." };
  if (!(await planHandles(task)).includes(agent.handle)) return { ok: false, error: "You're not part of this plan." };

  const db = adminClient();
  const { data: before } = await db.from("step_responses").select("value").eq("step_id", stepId).eq("agent_id", agent.id).maybeSingle();
  const previous = (before?.value as { response?: string } | null)?.response;
  if (previous === response) return { ok: true };

  await db.from("step_responses").upsert(
    { step_id: stepId, agent_id: agent.id, answered_by: "human", value: { response } },
    { onConflict: "step_id,agent_id" },
  );
  const now = response === "in" ? "is in ✅" : "can't make it ❌";
  await postMessage({
    conversationId: task.group_conversation_id,
    from: "system",
    content: previous ? `${agent.display_name} changed their answer: ${now}` : `${agent.display_name} ${now}`,
    metadata: { kind: "event", step_id: stepId },
  });
  return { ok: true };
}

/** A vote is always the person's own; agents can only suggest. Closes when everyone voted. */
export async function votePoll(stepId: string, userId: string, agent: AgentRow, option: string): Promise<Result> {
  const step = await loadStep(stepId);
  const task = step?.tasks;
  if (!step || !task || step.type !== "poll" || !task.group_conversation_id) return { ok: false, error: "Not found." };
  if (!(await isMember(task.group_conversation_id, userId))) return { ok: false, error: "Not found." };
  const config = step.config as unknown as PollConfig;
  if (!config.voters.includes(agent.handle)) return { ok: false, error: "You're not part of this poll." };
  if (step.status === "done" || (step.result as { closed?: boolean } | null)?.closed) return { ok: false, error: "This poll is closed." };
  if (!config.options.includes(option)) return { ok: false, error: "That isn't one of the options." };

  const db = adminClient();
  await db.from("step_responses").upsert(
    { step_id: stepId, agent_id: agent.id, answered_by: "human", value: { option } },
    { onConflict: "step_id,agent_id" },
  );
  const { count } = await db.from("step_responses").select("*", { count: "exact", head: true }).eq("step_id", stepId);
  if ((count ?? 0) >= config.voters.length) return closePollStep(stepId, null);
  return { ok: true };
}

/** Organiser closes early (or everyone voted): code tallies, the result is announced. */
export async function closePollStep(stepId: string, organiserUserId: string | null): Promise<Result> {
  const step = await loadStep(stepId);
  const task = step?.tasks;
  if (!step || !task || step.type !== "poll") return { ok: false, error: "Not found." };
  if (organiserUserId !== null && task.owner_id !== organiserUserId) return { ok: false, error: "Only the organiser can close the poll." };

  const db = adminClient();
  const config = step.config as unknown as PollConfig;
  const { data: votes } = await db.from("step_responses").select("value").eq("step_id", stepId);
  const result = tally(config.options, (votes ?? []).map((v) => (v.value as { option: string }).option), config.voters.length);
  // Only the first closer wins; repeated closes are no-ops.
  const { data: closed } = await db
    .from("plan_steps")
    .update({ status: "done", result: { closed: true, ...result } })
    .eq("id", stepId)
    .neq("status", "done")
    .select("id");
  if (!closed?.length) return { ok: true };

  const text = describeResult(config.question, result);
  if (task.group_conversation_id) {
    await postMessage({ conversationId: task.group_conversation_id, from: "system", content: text, metadata: { kind: "event", step_id: stepId } });
  }
  await postMessage({ conversationId: task.conversation_id, from: "agent", agentId: task.initiator_agent, content: text, metadata: { kind: "info", task_id: task.id } });
  return { ok: true, wake: (await wakeTask(task.id)) ? task.id : null };
}
