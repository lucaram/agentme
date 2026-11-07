import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { isMember, postMessage } from "@/lib/data/chat";
import type { AgentRow } from "@/lib/data/agents";
import { describeResult, tally, type PollConfig } from "./poll";
import { describeTransition, evaluate, type RsvpAnswer, type ThresholdConfig } from "./threshold";
import type { AssignConfig } from "./blocks/assign";
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

/** Current RSVP answers on a step, with handles, oldest "yes" first. */
async function loadAnswers(stepId: string): Promise<RsvpAnswer[]> {
  const db = adminClient();
  const { data } = await db.from("step_responses").select("agent_id, value, updated_at").eq("step_id", stepId);
  const ids = (data ?? []).map((r) => r.agent_id);
  const { data: agents } = ids.length ? await db.from("agents").select("id, handle").in("id", ids) : { data: [] };
  const handle = new Map((agents ?? []).map((a) => [a.id, a.handle]));
  return (data ?? []).map((r) => ({
    handle: handle.get(r.agent_id) ?? "",
    response: (r.value as { response: "in" | "out" }).response,
    at: r.updated_at,
  }));
}

/**
 * RSVP v2 + Threshold: "in" or "out", always the person's own action,
 * changeable at any time. With a maximum, extra "yes" answers join a waitlist
 * (in the order they answered) and move up automatically when a place opens.
 * With a minimum, the group is told when the plan is on, or no longer is.
 * Everything is announced as neutral event lines in the group.
 */
export async function respondRsvp(stepId: string, userId: string, agent: AgentRow, response: "in" | "out"): Promise<Result> {
  const step = await loadStep(stepId);
  const task = step?.tasks;
  if (!step || !task || step.type !== "rsvp" || !task.group_conversation_id) return { ok: false, error: "Not found." };
  if (!(await isMember(task.group_conversation_id, userId))) return { ok: false, error: "Not found." };
  const handles = await planHandles(task);
  if (!handles.includes(agent.handle)) return { ok: false, error: "You're not part of this plan." };

  const db = adminClient();
  const cfg = step.config as unknown as ThresholdConfig;
  const beforeAnswers = await loadAnswers(stepId);
  const previous = beforeAnswers.find((a) => a.handle === agent.handle)?.response;
  if (previous === response) return { ok: true };

  await db.from("step_responses").upsert(
    { step_id: stepId, agent_id: agent.id, answered_by: "human", value: { response } },
    { onConflict: "step_id,agent_id" },
  );

  const before = evaluate(beforeAnswers, cfg);
  const after = evaluate(await loadAnswers(stepId), cfg);
  const { data: people } = await db.from("agents").select("handle, display_name").in("handle", handles);
  const names = new Map((people ?? []).map((a) => [a.handle, a.display_name]));
  const lines = describeTransition(before, after, cfg, { handle: agent.handle, name: agent.display_name, changed: Boolean(previous) }, names);
  for (const content of lines) {
    await postMessage({ conversationId: task.group_conversation_id, from: "system", content, metadata: { kind: "event", step_id: stepId } });
  }
  // The organiser hears about the threshold in their own chat too.
  if (cfg.min && before.on !== after.on) {
    await postMessage({
      conversationId: task.conversation_id,
      from: "agent",
      agentId: task.initiator_agent,
      content: after.on ? `It's on! ${after.going.length} of ${cfg.min} needed are in.` : `Heads-up: only ${after.going.length} of ${cfg.min} needed are in now.`,
      metadata: { kind: "info", task_id: task.id },
    });
  }
  return { ok: true };
}

// ------------------------------------------------------------- assign

/** Claim an item on a sign-up list for yourself. Nobody can be assigned by someone else. */
export async function claimItem(stepId: string, userId: string, agent: AgentRow, item: string): Promise<Result> {
  const step = await loadStep(stepId);
  const task = step?.tasks;
  if (!step || !task || step.type !== "assign" || !task.group_conversation_id) return { ok: false, error: "Not found." };
  if (!(await isMember(task.group_conversation_id, userId))) return { ok: false, error: "Not found." };
  const config = step.config as unknown as AssignConfig;
  if (!config.people.includes(agent.handle)) return { ok: false, error: "You're not part of this list." };
  if (!config.items.includes(item)) return { ok: false, error: "That isn't on the list." };

  const db = adminClient();
  // The primary key (step, item) makes double-claiming impossible, even at the same moment.
  const { error } = await db.from("item_claims").insert({ step_id: stepId, item, agent_id: agent.id });
  if (error) {
    const { data: holder } = await db.from("item_claims").select("agent_id").eq("step_id", stepId).eq("item", item).maybeSingle();
    if (holder?.agent_id === agent.id) return { ok: true };
    const { data: other } = holder ? await db.from("agents").select("handle").eq("id", holder.agent_id).maybeSingle() : { data: null };
    return { ok: false, error: `Already taken${other ? ` by @${other.handle}` : ""}.` };
  }
  await postMessage({ conversationId: task.group_conversation_id, from: "system", content: `${agent.display_name} will bring/do: ${item}`, metadata: { kind: "event", step_id: stepId } });

  const { count } = await db.from("item_claims").select("*", { count: "exact", head: true }).eq("step_id", stepId);
  if ((count ?? 0) < config.items.length) return { ok: true };
  // Everything covered: announce once and let the plan complete.
  const { data: done } = await db.from("plan_steps").update({ status: "done", result: { complete: true } }).eq("id", stepId).neq("status", "done").select("id");
  if (!done?.length) return { ok: true };
  await postMessage({ conversationId: task.group_conversation_id, from: "system", content: "Everything is covered ✅", metadata: { kind: "event", step_id: stepId } });
  await postMessage({ conversationId: task.conversation_id, from: "agent", agentId: task.initiator_agent, content: `Everything on “${config.title}” is covered ✅`, metadata: { kind: "info", task_id: task.id } });
  return { ok: true, wake: (await wakeTask(task.id)) ? task.id : null };
}

/** Give back an item you claimed. */
export async function unclaimItem(stepId: string, userId: string, agent: AgentRow, item: string): Promise<Result> {
  const step = await loadStep(stepId);
  const task = step?.tasks;
  if (!step || !task || step.type !== "assign" || !task.group_conversation_id) return { ok: false, error: "Not found." };
  if (!(await isMember(task.group_conversation_id, userId))) return { ok: false, error: "Not found." };
  const { data } = await adminClient().from("item_claims").delete().eq("step_id", stepId).eq("item", item).eq("agent_id", agent.id).select("item");
  if (!data?.length) return { ok: false, error: "You haven't claimed that." };
  await postMessage({ conversationId: task.group_conversation_id, from: "system", content: `${agent.display_name} can't bring/do ${item} anymore — it's open again.`, metadata: { kind: "event", step_id: stepId } });
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
