import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { llm, LLMError } from "@/lib/llm";
import { sendAgentMessage } from "@/lib/a2a/client";
import { extractMentions } from "@/lib/policy/handles";
import { CATEGORY_LABELS, isRequestableCategory } from "@/lib/policy/disclosure";
import { getAgentByHandle, getAgentById, getRelationship, type AgentRow } from "@/lib/data/agents";
import { createConversation, findConversation, getConversation, isMember, postMessage } from "@/lib/data/chat";
import { INTENT_SYSTEM, OWNER_CHAT_SYSTEM } from "@/lib/agents/prompts";
import { asJson } from "@/lib/data/json";
import { MAX_PLAN_PEOPLE, type TaskParsed } from "@/lib/plans/types";
import { coordinationSteps, createSteps } from "@/lib/plans/steps";
import { withdrawInboxForTask } from "@/lib/plans/inbox";
import { describeRetry, hit } from "@/lib/limits";
import { displayClock, heuristicIntent } from "./heuristics";
import { IntentSchema, type Intent, type Proposal } from "./schemas";

export type { TaskParsed } from "@/lib/plans/types";

const listHandles = (handles: string[]) =>
  handles.map((h) => `@${h}`).join(handles.length > 2 ? ", " : " and ").replace(/, (@\w+)$/, " and $1");

function errorText(error: unknown) {
  if (error instanceof LLMError) return error.message;
  return error instanceof Error ? error.message : "Something went wrong.";
}

// ------------------------------------------------------------- My Agent chat

/**
 * The owner wrote to their own agent. Either start a coordination task (which
 * needs explicit approval before anything is sent) or just reply.
 */
export async function handleOwnerMessage(opts: { userId: string; agent: AgentRow; conversationId: string; text: string }) {
  const { userId, agent, conversationId, text } = opts;
  await postMessage({ conversationId, from: "human", userId, content: text });

  const mentions = extractMentions(text).filter((h) => h !== agent.handle);
  let intent: Intent;
  if (mentions.length === 0) {
    intent = { ...heuristicIntent(text), is_coordination: false };
  } else {
    try {
      intent = await llm().generateObject({
        purpose: "intent",
        tier: "fast",
        system: INTENT_SYSTEM,
        messages: [{ role: "user", content: text }],
        schema: IntentSchema,
        maxTokens: 1000,
        mockContext: { text },
      });
    } catch {
      // Intent parsing is low risk; fall back to deterministic parsing.
      intent = heuristicIntent(text);
    }
  }

  // Participants come from the @mentions the OWNER typed, never from the model alone.
  const participants = mentions;
  if (!intent.is_coordination || participants.length === 0) {
    return replyToOwner(agent, conversationId, text);
  }

  const valid: string[] = [];
  const rejected: string[] = [];
  for (const handle of participants) {
    const other = await getAgentByHandle(handle);
    if (other && other.type === "personal" && (await getRelationship(agent.id, other.id)) === "accepted") valid.push(handle);
    else rejected.push(handle);
  }
  if (rejected.length) {
    await postMessage({
      conversationId,
      from: "agent",
      agentId: agent.id,
      content: `I can only coordinate with people in your contacts. ${listHandles(rejected)} ${rejected.length > 1 ? "aren't contacts" : "isn't a contact"} yet.`,
    });
  }
  if (!valid.length) return;
  if (valid.length + 1 > MAX_PLAN_PEOPLE) {
    await postMessage({
      conversationId,
      from: "agent",
      agentId: agent.id,
      content: `A plan can include up to ${MAX_PLAN_PEOPLE} people, including you. Please mention fewer people.`,
    });
    return;
  }

  const limit = await hit("tasksPerUser", userId);
  if (!limit.allowed) {
    await postMessage({
      conversationId,
      from: "agent",
      agentId: agent.id,
      content: `You've started a lot of plans recently. Please try again in ${describeRetry(limit.retryAfterSeconds)}.`,
    });
    return;
  }

  const categories = [...new Set(["availability", ...intent.categories])].filter(isRequestableCategory);
  const parsed: TaskParsed = { event: intent.event || "meetup", window: intent.window || "this week", participants: valid, categories };

  const { data: task, error } = await adminClient()
    .from("tasks")
    .insert({ owner_id: userId, initiator_agent: agent.id, conversation_id: conversationId, goal: text, parsed: asJson(parsed) })
    .select("id")
    .single();
  if (error) throw error;
  await createSteps(task.id, coordinationSteps(parsed));

  const asks = categories.map((c) => CATEGORY_LABELS[c].toLowerCase()).join(" and ");
  await postMessage({
    conversationId,
    from: "agent",
    agentId: agent.id,
    content: `I'll ask ${listHandles(valid)}'s agents for their ${asks} for ${parsed.event} (${parsed.window}). Nothing else will be shared. Approve?`,
    metadata: { kind: "task_card", task_id: task.id },
  });
  return task.id;
}

async function replyToOwner(agent: AgentRow, conversationId: string, text: string) {
  const { data: history } = await adminClient()
    .from("messages")
    .select("content, sender_agent_id")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(10);
  const turns = (history ?? []).reverse().map((m) => ({
    role: (m.sender_agent_id ? "assistant" : "user") as "assistant" | "user",
    content: m.content,
  }));
  // The API needs the conversation to start with a user turn.
  while (turns.length && turns[0].role !== "user") turns.shift();

  let reply: string;
  try {
    reply = await llm().generateText({
      purpose: "owner_chat",
      tier: "smart",
      system: `${OWNER_CHAT_SYSTEM}\nYour owner is ${agent.display_name} (@${agent.handle}).`,
      messages: turns.length ? turns : [{ role: "user", content: text }],
      maxTokens: 2000,
      mockContext: { text },
    });
  } catch (error) {
    reply = `Sorry — I couldn't think that through (${errorText(error)}).`;
  }
  await postMessage({ conversationId, from: "agent", agentId: agent.id, content: reply || "…" });
}

// ------------------------------------------------------------- task lifecycle

async function loadOwnedTask(taskId: string, userId: string) {
  const { data: task } = await adminClient().from("tasks").select("*").eq("id", taskId).maybeSingle();
  if (!task || task.owner_id !== userId) throw new Error("Task not found");
  return task;
}

async function setTaskStatus(
  taskId: string,
  status: "running" | "waiting" | "proposal_ready" | "accepted" | "rejected" | "cancelled" | "failed",
  error?: string,
  onlyFrom?: string[],
) {
  let query = adminClient().from("tasks").update({ status, error: error ?? null }).eq("id", taskId);
  if (onlyFrom) query = query.in("status", onlyFrom as never[]);
  const { data } = await query.select("id");
  return Boolean(data?.length);
}

/** Owner approved the delegation. Returns true if the task should now run. */
export async function approveTask(taskId: string, userId: string): Promise<boolean> {
  await loadOwnedTask(taskId, userId);
  return setTaskStatus(taskId, "running", undefined, ["awaiting_approval"]);
}

export async function cancelTask(taskId: string, userId: string) {
  const task = await loadOwnedTask(taskId, userId);
  const changed = await setTaskStatus(taskId, "cancelled", undefined, ["awaiting_approval", "running", "waiting", "proposal_ready"]);
  if (changed) {
    // Nobody should be asked to answer for a plan that no longer exists.
    await withdrawInboxForTask(taskId);
    await postMessage({ conversationId: task.conversation_id, from: "agent", agentId: task.initiator_agent, content: "Stopped. I won't contact anyone else for this." });
  }
}

// Execution lives in the plan engine (lib/plans/engine.ts); re-exported for callers.
export { runTask, recoverStuckTasks, MAX_ATTEMPTS } from "@/lib/plans/engine";

// ------------------------------------------------------------- proposals

async function completeProposalStep(taskId: string, result: Record<string, unknown>) {
  await adminClient()
    .from("plan_steps")
    .update({ status: "done", result: asJson(result) })
    .eq("task_id", taskId)
    .eq("type", "proposal");
}

export async function decideProposal(proposalId: string, userId: string, decision: "accept" | "reject") {
  const db = adminClient();
  const { data: proposal } = await db.from("proposals").select("*, tasks(*)").eq("id", proposalId).maybeSingle();
  if (!proposal?.tasks || proposal.tasks.owner_id !== userId) throw new Error("Proposal not found");
  if (proposal.status !== "pending") return;
  const task = proposal.tasks;
  const content = proposal.content as unknown as Proposal & { disclaimer: string };

  if (decision === "reject") {
    await db.from("proposals").update({ status: "rejected" }).eq("id", proposalId);
    await completeProposalStep(task.id, { proposalId, decision: "rejected" });
    await setTaskStatus(task.id, "rejected");
    await postMessage({ conversationId: task.conversation_id, from: "agent", agentId: task.initiator_agent, content: "OK, I've dropped that plan. Nothing was sent to anyone." });
    return;
  }

  // Accept: share the proposal with the participants in a group conversation.
  const agents = await Promise.all(content.participants.map((h) => getAgentByHandle(h)));
  const memberIds = agents.filter((a): a is AgentRow => a !== null).map((a) => a.owner_id);
  const existing = await findConversation("group", [userId, ...memberIds]);
  const group = existing ? await getConversation(existing.id) : await createConversation({ kind: "group", title: content.title, createdBy: userId, memberIds });
  if (!group) throw new Error("Could not create group");

  await db.from("proposals").update({ status: "accepted", group_conversation_id: group.id }).eq("id", proposalId);
  const organiser = agents.find((a) => a?.id === task.initiator_agent);
  if (organiser) await db.from("proposal_responses").upsert({ proposal_id: proposalId, agent_id: organiser.id, response: "accepted" });
  await completeProposalStep(task.id, { proposalId, decision: "accepted", groupId: group.id });
  await setTaskStatus(task.id, "accepted");
  await postMessage({
    conversationId: group.id,
    from: "agent",
    agentId: task.initiator_agent,
    content: `Proposed plan: ${content.title}, ${content.day} at ${displayClock(content.time)}. ${content.disclaimer}`,
    metadata: { kind: "proposal", proposal_id: proposalId },
  });
  await postMessage({ conversationId: task.conversation_id, from: "agent", agentId: task.initiator_agent, content: "Shared the plan with everyone in a group chat. They can accept or decline there." });
}

/** A participant (not the organiser) answers a proposal shared in a group. */
export async function respondToProposal(proposalId: string, userId: string, agent: AgentRow, response: "accepted" | "declined") {
  const db = adminClient();
  const { data: proposal } = await db.from("proposals").select("*").eq("id", proposalId).maybeSingle();
  if (!proposal?.group_conversation_id || proposal.status !== "accepted") throw new Error("Proposal not found");
  if (!(await isMember(proposal.group_conversation_id, userId))) throw new Error("Proposal not found");
  const content = proposal.content as unknown as Proposal;
  if (!content.participants.includes(agent.handle)) throw new Error("You're not part of this plan");

  await db.from("proposal_responses").upsert({ proposal_id: proposalId, agent_id: agent.id, response });
  await postMessage({
    conversationId: proposal.group_conversation_id,
    from: "human",
    userId,
    content: response === "accepted" ? "✅ I'm in." : "❌ I can't make it.",
    metadata: { kind: "proposal_response", proposal_id: proposalId },
  });
}

// ------------------------------------------------------------- agent chats

/** The user asks another agent (e.g. a business) a question over A2A. */
export async function askAgent(opts: { userId: string; agent: AgentRow; conversationId: string; text: string }) {
  const conv = await getConversation(opts.conversationId);
  if (!conv?.target_agent || conv.kind !== "agent_chat") throw new Error("Not an agent conversation");
  const target = await getAgentById(conv.target_agent);
  if (!target) throw new Error("Agent not found");

  await postMessage({ conversationId: conv.id, from: "human", userId: opts.userId, content: opts.text });
  const result = await sendAgentMessage({ fromAgentId: opts.agent.id, toHandle: target.handle, text: opts.text });
  if (!result.ok) {
    await postMessage({ conversationId: conv.id, from: "system", content: `Message to @${target.handle} failed: ${result.error}`, metadata: { kind: "error" } });
    return;
  }
  await postMessage({ conversationId: conv.id, from: "agent", agentId: target.id, content: result.text || "(no answer)" });
}
