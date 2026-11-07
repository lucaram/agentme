import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { llm, LLMError } from "@/lib/llm";
import { sendAgentMessage } from "@/lib/a2a/client";
import { extractMentions } from "@/lib/policy/handles";
import { CATEGORY_LABELS, isRequestableCategory } from "@/lib/policy/disclosure";
import { getAgentByHandle, getAgentById, getRelationship, type AgentRow } from "@/lib/data/agents";
import { getConversation, postMessage } from "@/lib/data/chat";
import { INTENT_SYSTEM, OWNER_CHAT_SYSTEM, wrapUntrusted } from "@/lib/agents/prompts";
import { buildRecall } from "@/lib/agents/recall";
import { asJson } from "@/lib/data/json";
import { MAX_PLAN_PEOPLE, type NewStep, type TaskParsed } from "@/lib/plans/types";
import { coordinationSteps, createSteps, pollSteps, questionSteps } from "@/lib/plans/steps";
import { ensurePlanGroup } from "@/lib/plans/group";
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
 * The owner wrote to their own agent. Either prepare a plan (coordinate, poll,
 * question) that needs explicit approval before anything is sent, or reply
 * directly (general chat, or recall of their own plans).
 */
export async function handleOwnerMessage(opts: { userId: string; agent: AgentRow; conversationId: string; text: string }) {
  const { userId, agent, conversationId, text } = opts;
  await postMessage({ conversationId, from: "human", userId, content: text });

  const mentions = extractMentions(text).filter((h) => h !== agent.handle);
  if (mentions.length === 0) return replyToOwner(agent, userId, conversationId, text);

  let intent: Intent;
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
  if (intent.kind === "chat") return replyToOwner(agent, userId, conversationId, text);

  // Participants come from the @mentions the OWNER typed, never from the model alone.
  const say = (content: string) => postMessage({ conversationId, from: "agent", agentId: agent.id, content });
  const valid: string[] = [];
  const rejected: string[] = [];
  for (const handle of mentions) {
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

  // Code-side checks on what the model extracted.
  const options = [...new Set(intent.options.map((o) => o.trim()).filter((o) => o && o.length <= 60))].slice(0, 6);
  const question = intent.question.trim().slice(0, 500);
  if (intent.kind === "poll" && options.length < 2) {
    return say("For a poll I need at least two options, e.g. “Ask @marco and @paul to vote: Saturday or Sunday”.");
  }
  if ((intent.kind === "poll" || intent.kind === "question") && !question) {
    return say("What should I ask? For example: “Ask @marco if he can help me move on Sunday”.");
  }

  const limit = await hit("tasksPerUser", userId);
  if (!limit.allowed) return say(`You've started a lot of plans recently. Please try again in ${describeRetry(limit.retryAfterSeconds)}.`);

  let parsed: TaskParsed;
  let steps: NewStep[];
  let summary: string;
  if (intent.kind === "poll") {
    parsed = { kind: "poll", event: intent.event, window: intent.window, participants: valid, categories: [], question, options };
    steps = pollSteps(agent.handle, valid, question, options);
    summary = `I'll ask ${listHandles(valid)} to vote: “${question}” Options: ${options.join(" · ")}. You vote too. Options can't change once sent. Approve?`;
  } else if (intent.kind === "question") {
    parsed = { kind: "question", event: intent.event, window: intent.window, participants: valid, categories: [], question };
    steps = questionSteps(valid, question);
    summary = `I'll ask ${listHandles(valid)}: “${question}” Only they will see it, and they'll answer personally. Approve?`;
  } else {
    const categories = [...new Set(["availability", ...intent.categories])].filter(isRequestableCategory);
    parsed = { kind: "coordinate", event: intent.event || "meetup", window: intent.window || "this week", participants: valid, categories };
    steps = coordinationSteps(parsed);
    const asks = categories.map((c) => CATEGORY_LABELS[c].toLowerCase()).join(" and ");
    summary = `I'll ask ${listHandles(valid)}'s agents for their ${asks} for ${parsed.event} (${parsed.window}). Nothing else will be shared. Approve?`;
  }

  const { data: task, error } = await adminClient()
    .from("tasks")
    .insert({ owner_id: userId, initiator_agent: agent.id, conversation_id: conversationId, goal: text, parsed: asJson(parsed) })
    .select("id")
    .single();
  if (error) throw error;
  await createSteps(task.id, steps);
  await postMessage({ conversationId, from: "agent", agentId: agent.id, content: summary, metadata: { kind: "task_card", task_id: task.id } });
  return task.id;
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
