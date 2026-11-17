import "server-only";
import { personAgentAsk } from "@/lib/chat/mentions";
import { getAgentByHandle, getRelationship, type AgentRow } from "@/lib/data/agents";
import { getOrCreateMyAgentConversation, postMessage } from "@/lib/data/chat";
import { adminClient } from "@/lib/supabase/admin";
import { createSteps } from "@/lib/plans/steps";
import { asJson } from "@/lib/data/json";
import { hit, describeRetry } from "@/lib/limits";

/** Reuse the resumable question block and approval card; never send the chat. */
export async function preparePersonAsk({ text, userId, agent, conversationId, privateCard = false }: { text: string; userId: string; agent: AgentRow; conversationId: string; privateCard?: boolean }) {
  const ask = personAgentAsk(text); if (!ask) return false;
  const target = await getAgentByHandle(ask.handle); if (target?.type === "business") return false;
  const say = (content: string, metadata = {}) => postMessage({ conversationId, from: "agent", agentId: agent.id, content, metadata, ...(privateCard ? { visibleTo: userId } : {}) });
  if (!target || target.owner_id === userId || await getRelationship(agent.id, target.id) !== "accepted") { await say("I can only ask the agents of people in your contacts. Nothing has been sent."); return true; }
  const limit = await hit("tasksPerUser", userId);
  if (!limit.allowed) { await say(`Please try again in ${describeRetry(limit.retryAfterSeconds)}. Nothing has been sent.`); return true; }
  const destination = privateCard ? (await getOrCreateMyAgentConversation(userId)).id : conversationId;
  const { data: task, error } = await adminClient().from("tasks").insert({ owner_id: userId, initiator_agent: agent.id, conversation_id: destination, goal: text,
    parsed: asJson({ kind: "question", event: `Ask @${target.handle}’s agent`, window: "", participants: [target.handle], categories: [], question: ask.question }) }).select("id").single();
  if (error) throw error;
  await createSteps(task.id, [{ type: "question", config: { question: ask.question, participants: [target.handle] } }]);
  await say(`Ask @${target.handle}’s agent: “${ask.question}”\nOnly this question is sent. Their agent can ask them to answer. Nothing is sent until you approve.`, { kind: "task_card", task_id: task.id });
  return true;
}
