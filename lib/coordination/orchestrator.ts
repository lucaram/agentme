import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { llm, LLMError } from "@/lib/llm";
import { sendAgentMessage } from "@/lib/a2a/client";
import { extractMentions } from "@/lib/policy/handles";
import { getAgentByHandle, getAgentById, getRelationship, type AgentRow } from "@/lib/data/agents";
import { getConversation, postMessage } from "@/lib/data/chat";
import { COMPOSE_SYSTEM, OWNER_CHAT_SYSTEM, wrapUntrusted } from "@/lib/agents/prompts";
import { buildRecall } from "@/lib/agents/recall";
import { asJson } from "@/lib/data/json";
import { MAX_PLAN_PEOPLE, type TaskParsed } from "@/lib/plans/types";
import { createSteps } from "@/lib/plans/steps";
import { ComposeSchema, heuristicCompose, validateDraft, type PlanDraft } from "@/lib/plans/compose";
import { ensurePlanGroup } from "@/lib/plans/group";
import { withdrawInboxForTask } from "@/lib/plans/inbox";
import { createIntroduction, parseIntroduceCommand } from "@/lib/people/introductions";
import { describeRetry, hit } from "@/lib/limits";
import { displayClock } from "./heuristics";
import type { Proposal } from "./schemas";

export type { TaskParsed } from "@/lib/plans/types";

const listHandles = (handles: string[]) =>
  handles.map((h) => `@${h}`).join(handles.length > 2 ? ", " : " and ").replace(/, (@\w+)$/, " and $1");

function errorText(error: unknown) {
  if (error instanceof LLMError) return error.message;
  return error instanceof Error ? error.message : "Something went wrong.";
}

// ------------------------------------------------------------- My Agent chat

/**
 * The owner wrote to their own agent. Either prepare a plan (coordinate, poll,
 * question) that needs explicit approval before anything is sent, or reply
 * directly (general chat, or recall of their own plans).
 */
export async function handleOwnerMessage(opts: { userId: string; agent: AgentRow; conversationId: string; text: string }) {
  const { userId, agent, conversationId, text } = opts;
  await postMessage({ conversationId, from: "human", userId, content: text });

  // "introduce @luca to @paul": the owner's own instruction, so it goes out straight away.
  const intro = parseIntroduceCommand(text);
  if (intro) {
    const result = await createIntroduction(agent, intro.a, intro.b, intro.note);
    return postMessage({
      conversationId,
      from: "agent",
      agentId: agent.id,
      content: result.ok
        ? `🤝 Done. @${intro.a} and @${intro.b} will each see your introduction in their Inbox, and they'll be connected only if both say yes.`
        : result.error,
    });
  }

  const mentions = extractMentions(text).filter((h) => h !== agent.handle);
  if (mentions.length === 0) return replyToOwner(agent, userId, conversationId, text);
  return composePlan({
    userId,
    agent,
    text,
    participants: mentions,
    say: (content) => postMessage({ conversationId, from: "agent", agentId: agent.id, content }),
    card: { conversationId },
    taskConversationId: conversationId,
    onChat: () => replyToOwner(agent, userId, conversationId, text),
  });
}

/**
 * Compose a plan from a request, validate it in code, and post the approval card.
 * Shared by My Agent and by "@agent ..." in any chat. Nothing is sent to anyone
 * until the organiser approves.
 */
export async function composePlan(opts: {
  userId: string;
  agent: AgentRow;
  text: string;
  /** Handles to involve (from the owner's @mentions, or the chat's members). */
  participants: string[];
  /** Where to tell the owner about problems. */
  say: (content: string) => Promise<unknown>;
  /** Where the approval card goes; private to the owner when it's a shared chat. */
  card: { conversationId: string; visibleTo?: string };
  /** The owner's own conversation for progress messages (My Agent). */
  taskConversationId: string;
  /** Share the plan's blocks into this existing chat instead of a new group. */
  groupConversationId?: string | null;
  /** From a chat: its members are the participants (passed separately, never mixed into the owner's words). */
  chatMembers?: string[];
  onChat: () => Promise<unknown>;
}) {
  const { userId, agent, text, say } = opts;

  // The AI composes a plan from building blocks; code validates it below.
  let draft: PlanDraft;
  try {
    draft = await llm().generateObject({
      purpose: "compose",
      tier: "smart",
      system: COMPOSE_SYSTEM,
      messages: [
        {
          role: "user",
          content: opts.chatMembers?.length ? `${text}

(Sent in a chat with ${opts.chatMembers.map((h) => `@${h}`).join(", ")}: they are the people to involve.)` : text,
        },
      ],
      schema: ComposeSchema,
      maxTokens: 2000,
      mockContext: { text, chatMembers: opts.chatMembers ?? [] },
    });
  } catch {
    // Composition is checked by code anyway; fall back to deterministic composition.
    draft = heuristicCompose(text, opts.chatMembers ?? []);
  }
  if (draft.kind === "chat" || !draft.steps.length) return opts.onChat();

  // Participants come from the owner (mentions or chat members), never from the model.
  const valid: string[] = [];
  const rejected: string[] = [];
  for (const handle of [...new Set(opts.participants)].filter((h) => h !== agent.handle)) {
    const other = await getAgentByHandle(handle);
    if (other && other.type === "personal" && (await getRelationship(agent.id, other.id)) === "accepted") valid.push(handle);
    else rejected.push(handle);
  }
  if (rejected.length) {
    await say(`I can only involve people in your contacts. ${listHandles(rejected)} ${rejected.length > 1 ? "aren't contacts" : "isn't a contact"} yet.`);
  }
  if (!valid.length) return;
  if (valid.length + 1 > MAX_PLAN_PEOPLE) {
    return say(`A plan can include up to ${MAX_PLAN_PEOPLE} people, including you. Please mention fewer people.`);
  }

  const plan = validateDraft(draft, { organiser: agent.handle, participants: valid });
  if (!plan.ok) return say(`I couldn't set that up: ${plan.error}`);

  const limit = await hit("tasksPerUser", userId);
  if (!limit.allowed) return say(`You've started a lot of plans recently. Please try again in ${describeRetry(limit.retryAfterSeconds)}.`);

  const { data: task, error } = await adminClient()
    .from("tasks")
    .insert({
      owner_id: userId,
      initiator_agent: agent.id,
      conversation_id: opts.taskConversationId,
      goal: text,
      parsed: asJson(plan.parsed),
      group_conversation_id: opts.groupConversationId ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  await createSteps(task.id, plan.steps);
  await postMessage({
    conversationId: opts.card.conversationId,
    from: "agent",
    agentId: agent.id,
    content: planSummary(valid, plan.preview),
    metadata: { kind: "task_card", task_id: task.id },
    visibleTo: opts.card.visibleTo,
  });
  return task.id;
}

function planSummary(people: string[], preview: string[]) {
  const steps = preview.length === 1 ? preview[0] : preview.map((line, i) => `${i + 1}. ${line}`).join("\n");
  return `Here's the plan with ${listHandles(people)}:\n${steps}\nNothing is sent until you approve, and you can edit it first.`;
}

/**
 * The organiser edits the plan in the preview before approving. Same code
 * checks as a freshly composed plan; only possible while awaiting approval.
 */
export async function updateDraft(taskId: string, userId: string, draft: PlanDraft): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = adminClient();
  const { data: task } = await db.from("tasks").select("*").eq("id", taskId).maybeSingle();
  if (!task || task.owner_id !== userId) return { ok: false, error: "Not found." };
  if (task.status !== "awaiting_approval") return { ok: false, error: "This plan was already approved or stopped." };
  const organiser = await getAgentById(task.initiator_agent);
  const participants = (task.parsed as unknown as TaskParsed).participants ?? [];
  const parsedDraft = ComposeSchema.safeParse({ ...draft, kind: "plan" });
  if (!parsedDraft.success) return { ok: false, error: "Some fields are too long or invalid." };
  const plan = validateDraft(parsedDraft.data, { organiser: organiser?.handle ?? "", participants });
  if (!plan.ok) return { ok: false, error: plan.error };

  await db.from("plan_steps").delete().eq("task_id", taskId);
  await createSteps(taskId, plan.steps);
  await db.from("tasks").update({ parsed: asJson(plan.parsed) }).eq("id", taskId).eq("status", "awaiting_approval");
  await db
    .from("messages")
    .update({ content: planSummary(participants, plan.preview) })
    .eq("metadata->>task_id", taskId)
    .eq("metadata->>kind", "task_card");
  return { ok: true };
}

/** Direct reply from the owner's own agent, with Recall of the plans the owner can see. */
async function replyToOwner(agent: AgentRow, userId: string, conversationId: string, text: string) {
  const db = adminClient();
  const [{ data: history }, recall] = await Promise.all([
    db.from("messages").select("content, sender_agent_id").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(10),
    buildRecall(userId),
  ]);
  const turns = (history ?? []).reverse().map((m) => ({
    role: (m.sender_agent_id ? "assistant" : "user") as "assistant" | "user",
    content: m.content,
  }));
  // The API needs the conversation to start with a user turn.
  while (turns.length && turns[0].role !== "user") turns.shift();

  // Plans contain other people's words, so they're passed as data, not instructions.
  const recallBlock = recall.length ? `\n\n${wrapUntrusted("your_plans", JSON.stringify(recall, null, 1))}` : "";
  let reply: string;
  try {
    reply = await llm().generateText({
      purpose: "owner_chat",
      tier: "smart",
      system: `${OWNER_CHAT_SYSTEM}\nYour owner is ${agent.display_name} (@${agent.handle}). Today is ${new Date().toDateString()}.${recallBlock}`,
      messages: turns.length ? turns : [{ role: "user", content: text }],
      maxTokens: 2000,
      mockContext: { text, recall },
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
  await adminClient().from("plan_steps").update({ status: "done", result: asJson(result) }).eq("task_id", taskId).eq("type", "proposal");
}

/**
 * The organiser decides on the drafted plan. Accepting shares it in a group and
 * resumes the engine (which opens RSVPs). Returns true if the task should run.
 */
export async function decideProposal(proposalId: string, userId: string, decision: "accept" | "reject"): Promise<boolean> {
  const db = adminClient();
  const { data: proposal } = await db.from("proposals").select("*, tasks(*)").eq("id", proposalId).maybeSingle();
  if (!proposal?.tasks || proposal.tasks.owner_id !== userId) throw new Error("Proposal not found");
  if (proposal.status !== "pending") return false;
  const task = proposal.tasks;
  const content = proposal.content as unknown as Proposal & { disclaimer: string };

  if (decision === "reject") {
    await db.from("proposals").update({ status: "rejected" }).eq("id", proposalId);
    await completeProposalStep(task.id, { proposalId, decision: "rejected" });
    await setTaskStatus(task.id, "rejected");
    await postMessage({ conversationId: task.conversation_id, from: "agent", agentId: task.initiator_agent, content: "OK, I've dropped that plan. Nothing was sent to anyone." });
    return false;
  }

  // Accept: share the proposal with the participants in the plan's group.
  const organiserHandle = (await getAgentById(task.initiator_agent))?.handle;
  const group = await ensurePlanGroup(task, content.participants.filter((h) => h !== organiserHandle), content.title);
  const { data: claimed } = await db.from("proposals").update({ status: "accepted", group_conversation_id: group.id }).eq("id", proposalId).eq("status", "pending").select("id");
  if (!claimed?.length) return false;
  await completeProposalStep(task.id, { proposalId, decision: "accepted", groupId: group.id });
  await postMessage({
    conversationId: group.id,
    from: "agent",
    agentId: task.initiator_agent,
    content: `Proposed plan: ${content.title}, ${content.day} at ${displayClock(content.time)}. ${content.disclaimer}`,
    metadata: { kind: "proposal", proposal_id: proposalId, task_id: task.id },
  });
  await postMessage({ conversationId: task.conversation_id, from: "agent", agentId: task.initiator_agent, content: "Shared the plan with everyone in a group chat. They can say if they're in there." });
  // Continue the plan (RSVP step) in the engine.
  return setTaskStatus(task.id, "running", undefined, ["proposal_ready"]);
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
