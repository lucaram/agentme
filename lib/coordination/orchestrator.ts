import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { llm, LLMError } from "@/lib/llm";
import { sendAgentMessage } from "@/lib/a2a/client";
import { extractMentions } from "@/lib/policy/handles";
import { CATEGORY_LABELS, isRequestableCategory } from "@/lib/policy/disclosure";
import { getAgentByHandle, getAgentById, getFacts, getRelationship, type AgentRow } from "@/lib/data/agents";
import { createConversation, findConversation, getConversation, isMember, postMessage } from "@/lib/data/chat";
import { INTENT_SYSTEM, OWNER_CHAT_SYSTEM, PROPOSAL_SYSTEM, wrapUntrusted } from "@/lib/agents/prompts";
import { asJson } from "@/lib/data/json";
import type { Database } from "@/lib/database.types";
import { withUsageContext } from "@/lib/usage/context";
import { describeRetry, hit } from "@/lib/limits";
import { displayClock, heuristicIntent, heuristicPlan, relevantClause, type ParticipantReply } from "./heuristics";
import {
  CoordinationReplySchema,
  DISCLAIMER,
  IntentSchema,
  ProposalSchema,
  type CoordinationRequest,
  type Intent,
  type Proposal,
} from "./schemas";
import { validateProposal } from "./validate";

export type TaskParsed = {
  event: string;
  window: string;
  participants: string[];
  categories: string[];
};

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
  status: "running" | "proposal_ready" | "accepted" | "rejected" | "cancelled" | "failed",
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
  const changed = await setTaskStatus(taskId, "cancelled", undefined, ["awaiting_approval", "running", "proposal_ready"]);
  if (changed) {
    await postMessage({ conversationId: task.conversation_id, from: "agent", agentId: task.initiator_agent, content: "Stopped. I won't contact anyone else for this." });
  }
}

// ------------------------------------------------------------- durable execution
//
// A running task is advanced only by the worker holding its lease. If the
// server dies mid-task the lease expires and recoverStuckTasks() (run by the
// background sweeper) resumes it: replies that already arrived are reused,
// interrupted exchanges are retried, and after MAX_ATTEMPTS the task fails
// visibly instead of hanging in "running".

const LEASE_SECONDS = 180;
export const MAX_ATTEMPTS = 3;
/** A freshly approved task gets this long to be claimed before the sweeper steps in. */
const UNCLAIMED_GRACE_MS = 30_000;

type TaskRow = Database["public"]["Tables"]["tasks"]["Row"];
type ExchangeRow = Database["public"]["Tables"]["task_exchanges"]["Row"];

class LeaseLost extends Error {}

/** Claims the task and runs it to completion (or failure). Safe to call concurrently. */
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

async function executeTask(task: TaskRow) {
  const db = adminClient();
  const taskId = task.id;
  const token = task.lease_token!;
  const parsed = task.parsed as unknown as TaskParsed;

  /** Status change that only succeeds while we still hold the lease. */
  const finish = async (status: "proposal_ready" | "failed", error?: string) => {
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
    if (await finish("failed", message)) {
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

    const { data: previous } = await db.from("task_exchanges").select("*").eq("task_id", taskId).order("created_at");
    const request: CoordinationRequest = {
      type: "agentme.coordination.request",
      event: parsed.event,
      window: parsed.window,
      categories: parsed.categories,
    };

    const replies = await Promise.all(
      parsed.participants.map((handle) => askParticipant({ taskId, organiser, handle, request, parsed, previous: previous ?? [] })),
    );

    await renew();
    const answered = replies.filter((r): r is ParticipantReply => r !== null);
    if (!answered.length) return fail("none of the agents replied.");

    // The organiser's own preferences: the owner's own agent may use them for the owner.
    const ownFacts = await getFacts(organiser.id);
    const ownAvailability = ownFacts.find((f) => f.category === "availability")?.value ?? null;
    const own: ParticipantReply = {
      handle: organiser.handle,
      availability: ownAvailability ? relevantClause(ownAvailability, parsed.window) : null,
      food: ownFacts.find((f) => f.category === "food")?.value ?? null,
    };

    // A proposal may already exist if we crashed right after saving it.
    let { data: saved } = await db.from("proposals").select("id, content").eq("task_id", taskId).maybeSingle();
    if (!saved) {
      const proposal = await draftProposal(organiser.handle, [own, ...answered], parsed);
      if (!proposal) return fail("I couldn't find a time that works for everyone.");
      await renew();
      const inserted = await db
        .from("proposals")
        .insert({ task_id: taskId, content: asJson({ ...proposal, disclaimer: DISCLAIMER }) })
        .select("id, content")
        .single();
      if (inserted.error) {
        // Unique violation: a concurrent worker saved one first. Use it.
        const existing = await db.from("proposals").select("id, content").eq("task_id", taskId).single();
        saved = existing.data;
      } else {
        saved = inserted.data;
      }
    }
    if (!saved) throw new Error("could not save the proposal");
    if (!(await finish("proposal_ready"))) return;

    const content = saved.content as unknown as Proposal;
    await postMessageOnce(task.conversation_id, saved.id, {
      conversationId: task.conversation_id,
      from: "agent",
      agentId: organiser.id,
      content: `Here's a suggested plan: ${content.title}, ${content.day} at ${displayClock(content.time)}. ${DISCLAIMER}`,
      metadata: { kind: "proposal", proposal_id: saved.id, task_id: taskId },
    });
  } catch (error) {
    if (error instanceof LeaseLost) return; // cancelled or taken over: stop quietly
    await fail(errorText(error));
  }
}

/** Asks one participant's agent, reusing a reply that already arrived on an earlier attempt. */
async function askParticipant(opts: {
  taskId: string;
  organiser: AgentRow;
  handle: string;
  request: CoordinationRequest;
  parsed: TaskParsed;
  previous: ExchangeRow[];
}): Promise<ParticipantReply | null> {
  const { taskId, organiser, handle, request, parsed } = opts;
  const db = adminClient();
  const target = await getAgentByHandle(handle);
  const prior = target ? opts.previous.filter((e) => e.to_agent === target.id) : [];

  const done = prior.find((e) => e.status === "completed");
  if (done) {
    const reply = CoordinationReplySchema.safeParse((done.response as { data?: unknown } | null)?.data);
    return reply.success ? { handle, availability: reply.data.availability, food: reply.data.food } : null;
  }
  if (prior.some((e) => e.status === "refused")) return null; // a refusal is final
  const interrupted = prior.filter((e) => e.status === "pending").map((e) => e.id);
  if (interrupted.length) {
    await db
      .from("task_exchanges")
      .update({ status: "failed", error: "Interrupted (server restarted); retried." })
      .in("id", interrupted)
      .eq("status", "pending");
  }

  const { data: exchange } = await db
    .from("task_exchanges")
    .insert({ task_id: taskId, from_agent: organiser.id, to_agent: target?.id ?? null, skill: "coordination.availability", request: asJson(request) })
    .select("id")
    .single();
  if (!target || !exchange) {
    if (exchange) await db.from("task_exchanges").update({ status: "failed", error: "Agent not found" }).eq("id", exchange.id);
    return null;
  }

  const started = Date.now();
  const result = await sendAgentMessage({
    fromAgentId: organiser.id,
    toHandle: handle,
    text: `@${organiser.handle}'s agent is organising ${parsed.event} (${parsed.window}). Could you share ${parsed.categories.join(", ")}?`,
    data: request,
    taskId,
    exchangeId: exchange.id,
  });
  const latency = Date.now() - started;

  if (!result.ok) {
    await db.from("task_exchanges").update({ status: "failed", error: result.error, latency_ms: latency }).eq("id", exchange.id).eq("status", "pending");
    return null;
  }
  await db.from("task_exchanges").update({ latency_ms: latency }).eq("id", exchange.id);
  const reply = CoordinationReplySchema.safeParse(result.data);
  if (!reply.success) return null;
  return { handle, availability: reply.data.availability, food: reply.data.food };
}

/** Posts a proposal message unless one for this proposal is already in the conversation. */
async function postMessageOnce(conversationId: string, proposalId: string, message: Parameters<typeof postMessage>[0]) {
  const { data } = await adminClient()
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("metadata->>proposal_id", proposalId)
    .limit(1);
  if (!data?.length) await postMessage(message);
}

async function draftProposal(organiser: string, replies: ParticipantReply[], parsed: TaskParsed): Promise<Proposal | null> {
  const repliesBlock = wrapUntrusted("untrusted_replies", JSON.stringify(replies, null, 2));
  const ask = `Organiser: @${organiser}\nEvent: ${parsed.event}\nWindow: ${parsed.window}\n\n${repliesBlock}`;
  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const proposal = await llm().generateObject({
        purpose: "proposal",
        tier: "smart",
        system: PROPOSAL_SYSTEM,
        messages: [{ role: "user", content: ask + feedback }],
        schema: ProposalSchema,
        maxTokens: 2000,
        mockContext: { organiser, replies, event: parsed.event, window: parsed.window },
      });
      const check = validateProposal(proposal, organiser, replies);
      if (check.ok) return proposal;
      feedback = `\n\nYour previous proposal was invalid: ${check.problems.join(" ")} Fix these problems.`;
    } catch {
      break;
    }
  }
  // Deterministic fallback, still validated.
  const fallback = heuristicPlan(organiser, replies, parsed.event, parsed.window);
  return validateProposal(fallback, organiser, replies).ok ? fallback : null;
}

// ------------------------------------------------------------- proposals

export async function decideProposal(proposalId: string, userId: string, decision: "accept" | "reject") {
  const db = adminClient();
  const { data: proposal } = await db.from("proposals").select("*, tasks(*)").eq("id", proposalId).maybeSingle();
  if (!proposal?.tasks || proposal.tasks.owner_id !== userId) throw new Error("Proposal not found");
  if (proposal.status !== "pending") return;
  const task = proposal.tasks;
  const content = proposal.content as unknown as Proposal & { disclaimer: string };

  if (decision === "reject") {
    await db.from("proposals").update({ status: "rejected" }).eq("id", proposalId);
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
