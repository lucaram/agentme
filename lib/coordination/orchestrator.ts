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

async function isCancelled(taskId: string) {
  const { data } = await adminClient().from("tasks").select("status").eq("id", taskId).single();
  return data?.status === "cancelled";
}

/**
 * Runs an approved task: asks each participant's agent over A2A (in parallel),
 * then drafts and validates a proposal. Every step is recorded and visible.
 */
export async function runTask(taskId: string) {
  const db = adminClient();
  const { data: task } = await db.from("tasks").select("*").eq("id", taskId).single();
  if (!task || task.status !== "running") return;
  const parsed = task.parsed as unknown as TaskParsed;
  const organiser = await getAgentById(task.initiator_agent);
  if (!organiser) return setTaskStatus(taskId, "failed", "Your agent no longer exists.");

  const fail = async (message: string) => {
    if (await setTaskStatus(taskId, "failed", message, ["running"])) {
      await postMessage({ conversationId: task.conversation_id, from: "agent", agentId: organiser.id, content: `I couldn't finish: ${message}`, metadata: { kind: "error", task_id: taskId } });
    }
  };

  try {
    const request: CoordinationRequest = {
      type: "agentme.coordination.request",
      event: parsed.event,
      window: parsed.window,
      categories: parsed.categories,
    };

    const replies = await Promise.all(
      parsed.participants.map(async (handle): Promise<ParticipantReply | null> => {
        const target = await getAgentByHandle(handle);
        const { data: exchange } = await db
          .from("task_exchanges")
          .insert({ task_id: taskId, from_agent: organiser.id, to_agent: target?.id ?? null, skill: "coordination.availability", request: asJson(request) })
          .select("id")
          .single();
        if (!target || !exchange) {
          if (exchange) await db.from("task_exchanges").update({ status: "failed", error: "Agent not found" }).eq("id", exchange.id);
          return null;
        }
        if (await isCancelled(taskId)) return null;

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
      }),
    );

    if (await isCancelled(taskId)) return;
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
    const everyone = [own, ...answered];

    const proposal = await draftProposal(organiser.handle, everyone, parsed);
    if (!proposal) return fail("I couldn't find a time that works for everyone.");
    if (await isCancelled(taskId)) return;

    const content = { ...proposal, disclaimer: DISCLAIMER };
    const { data: saved, error } = await db.from("proposals").insert({ task_id: taskId, content: asJson(content) }).select("id").single();
    if (error) throw error;
    if (!(await setTaskStatus(taskId, "proposal_ready", undefined, ["running"]))) return;
    await postMessage({
      conversationId: task.conversation_id,
      from: "agent",
      agentId: organiser.id,
      content: `Here's a suggested plan: ${proposal.title}, ${proposal.day} at ${displayClock(proposal.time)}. ${DISCLAIMER}`,
      metadata: { kind: "proposal", proposal_id: saved.id, task_id: taskId },
    });
  } catch (error) {
    await fail(errorText(error));
  }
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
