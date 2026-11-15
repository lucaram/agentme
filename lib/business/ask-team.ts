import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { getAgentById, getRelationship, type AgentRow } from "@/lib/data/agents";
import { isMember } from "@/lib/data/chat";
import { canContact } from "@/lib/policy/contactPolicy";
import { tellOwner, NEEDS_ANSWER } from "@/lib/requests/notify";
import { asJson } from "@/lib/data/json";
import { HandoffOfferSchema } from "./question-scope";
import { accountRestricted } from "@/lib/moderation/accounts";

/** Only the original asker may accept an offer, using server-saved content. */
export async function askTeam(userId: string, agent: AgentRow, messageId: string): Promise<{ error?: string; notice?: string }> {
  const db = adminClient();
  if (await accountRestricted(userId)) return { error: "This account is restricted by AGENTME." };
  if (!(await db.rpc("can_read_chat_message", { p_message: messageId, p_user: userId })).data) return { error: "Not found." };
  const { data: msg } = await db.from("messages").select("*").eq("id", messageId).maybeSingle();
  const meta = (msg?.metadata ?? {}) as Record<string, unknown>;
  if (!msg || msg.removed_at || agent.owner_id !== userId || meta.handoff_offer !== true || typeof meta.a2a_task !== "string" ||
    (msg.visible_to && msg.visible_to !== userId) || !(await isMember(msg.conversation_id, userId))) return { error: "Not found." };
  const { data: conv } = await db.from("conversations").select("kind, created_by, target_agent").eq("id", msg.conversation_id).single();
  const { data: exchange } = await db.from("task_exchanges").select("id, to_agent, response").eq("a2a_task_id", meta.a2a_task).eq("from_agent", agent.id).maybeSingle();
  const offer = HandoffOfferSchema.safeParse((exchange?.response as { data?: unknown } | null)?.data);
  if (!conv || !exchange?.to_agent || !offer.success || !msg.is_ai_generated || !msg.sender_agent_id) return { error: "Not found." };
  const mine = conv.created_by === userId && (
    (conv.kind === "my_agent" && msg.sender_agent_id === agent.id && meta.business_id === exchange.to_agent) ||
    (conv.kind === "agent_chat" && conv.target_agent === exchange.to_agent && msg.sender_agent_id === exchange.to_agent));
  const inGroup = ["group", "channel"].includes(conv.kind) && meta.asked_by === userId && msg.sender_agent_id === exchange.to_agent;
  if (!mine && !inGroup) return { error: "Not found." };
  const business = await getAgentById(exchange.to_agent);
  if (business && await accountRestricted(business.owner_id)) return { error: "This business is currently unavailable." };
  if (!business || !canContact(business.contact_policy, await getRelationship(agent.id, business.id)).allowed) return { error: "This business isn't accepting requests from you." };
  const { data, error } = await db.rpc("request_business_handoff", { p_exchange: exchange.id, p_caller: agent.id });
  const result = data?.[0];
  if (error || !result) return { error: "Couldn't ask the team just now. Please try again." };
  if (result.outcome === "caller_limit") return { error: "You've reached today's limit for questions to this team. Please try tomorrow." };
  if (result.outcome === "business_limit") return { error: "This team has reached today's request limit. Please try tomorrow or contact the business directly." };
  if (!result.item_id) return { error: "This offer is no longer available." };
  await db.rpc("link_business_receipt", { p_inbox: result.item_id });
  if (result.created) await tellOwner(business.owner_id, business.id, `@${agent.handle} asked ${business.display_name}: “${offer.data.question}” ${NEEDS_ANSWER}`);
  // Keep offers private in shared chats: UI state belongs to the original asker.
  const notice = result.created
    ? inGroup ? `Sent to the team. They'll reply in your private chat with @${business.handle}.` : "Sent to the team. They'll reply in this conversation."
    : "This question has already been sent to the team. Their answer belongs to the original request.";
  await db.from("messages").update({ metadata: asJson({ ...meta, handoff_sent: true }) }).eq("id", messageId);
  return { notice };
}
