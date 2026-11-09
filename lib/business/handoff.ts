import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { asJson } from "@/lib/data/json";
import { getAgentById } from "@/lib/data/agents";
import { createConversation, findConversation, postMessage } from "@/lib/data/chat";
import { relayToMyAgent } from "@/lib/agents/ask-business";

/**
 * A question the business agent couldn't answer was handed to the business's
 * team. Their answer (or "couldn't answer") goes back into the asker's chat
 * with the business.
 */
export async function relayTeamAnswer(item: { exchange_id: string | null; agent_id: string }, answer: string | null) {
  if (!item.exchange_id) return;
  const db = adminClient();
  const { data: exchange } = await db.from("task_exchanges").select("from_agent, a2a_task_id").eq("id", item.exchange_id).maybeSingle();
  const [asker, business] = await Promise.all([exchange?.from_agent ? getAgentById(exchange.from_agent) : null, getAgentById(item.agent_id)]);
  if (!asker || !business) return;
  // Asked by the person's own agent from My Agent: the answer goes back into that thread.
  if (await relayToMyAgent(exchange?.a2a_task_id ?? null, business, answer)) return;
  // Asked from a group or community: the answer arrives in a private chat with the business.
  const conv =
    (await findConversation("agent_chat", [asker.owner_id], business.id)) ??
    (await createConversation({ kind: "agent_chat", title: business.display_name, createdBy: asker.owner_id, memberIds: [], targetAgent: business.id }));
  await postMessage({
    conversationId: conv.id,
    from: "agent",
    agentId: business.id,
    content: answer ? `👤 The team at ${business.display_name}: ${answer}` : `The team at ${business.display_name} couldn't answer this one. You can contact them directly.`,
    metadata: { kind: "team_answer" },
  });
}

/** "Also add this to my business info": the agent can answer it by itself next time. */
export async function addToBusinessInfo(agentId: string, question: string, answer: string) {
  const db = adminClient();
  const { data: agent } = await db.from("agents").select("business_info").eq("id", agentId).single();
  const info = (agent?.business_info ?? {}) as { faqs?: { q: string; a: string }[] } & Record<string, unknown>;
  const faqs = [...(info.faqs ?? []), { q: question.slice(0, 300), a: answer.slice(0, 1000) }].slice(-50);
  await db.from("agents").update({ business_info: asJson({ ...info, faqs }) }).eq("id", agentId);
}
