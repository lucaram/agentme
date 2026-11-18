import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { getAgentById, getRelationship, type AgentRow } from "@/lib/data/agents";
import { isMember } from "@/lib/data/chat";
import { canContact } from "@/lib/policy/contactPolicy";
import { tellOwner, NEEDS_ANSWER } from "@/lib/requests/notify";
import { asJson } from "@/lib/data/json";
import { HandoffOfferSchema } from "./question-scope";
import { accountRestricted } from "@/lib/moderation/accounts";

/** The question goes to the business's team (within both sides' daily limits); its owner is told. */
async function handOff(agent: AgentRow, exchangeId: string, businessId: string, question: string): Promise<{ error: string } | { created: boolean }> {
  const db = adminClient();
  const business = await getAgentById(businessId);
  if (business && await accountRestricted(business.owner_id)) return { error: "This business is currently unavailable." };
  if (!business || !canContact(business.contact_policy, await getRelationship(agent.id, business.id)).allowed) return { error: "This business isn't accepting requests from you." };
  const { data, error } = await db.rpc("request_business_handoff", { p_exchange: exchangeId, p_caller: agent.id });
  const result = data?.[0];
  if (error || !result) return { error: "Couldn't ask the team just now. Please try again." };
  if (result.outcome === "caller_limit") return { error: "You've reached today's limit for questions to this team. Please try tomorrow." };
  if (result.outcome === "business_limit") return { error: "This team has reached today's request limit. Please try tomorrow or contact the business directly." };
  if (!result.item_id) return { error: "This offer is no longer available." };
  await db.rpc("link_business_receipt", { p_inbox: result.item_id });
  if (result.created) await tellOwner(business.owner_id, business.id, `@${agent.handle} asked ${business.display_name}: “${question}” ${NEEDS_ANSWER}`, result.item_id);
  return { created: Boolean(result.created) };
}

/**
 * "Ask the team" on one point of a comparison card, in your own My Agent: the business's agent didn't
 * know, so its team is asked that one question. Their answer fills in the cell.
 */
export async function askTeamForComparison(userId: string, agent: AgentRow, messageId: string, businessId: string, point: number): Promise<{ error?: string; notice?: string }> {
  const db = adminClient();
  if (await accountRestricted(userId)) return { error: "This account is restricted by AGENTME." };
  const { data: msg } = await db.from("messages").select("id, conversation_id, sender_agent_id, removed_at, metadata").eq("id", messageId).maybeSingle();
  const meta = (msg?.metadata ?? {}) as { kind?: string; cells?: { business_id: string; point: number; status: string; handoff?: boolean; a2a_task?: string | null }[] };
  if (!msg || msg.removed_at || meta.kind !== "business_comparison" || msg.sender_agent_id !== agent.id || agent.owner_id !== userId) return { error: "Not found." };
  const { data: conv } = await db.from("conversations").select("kind, created_by").eq("id", msg.conversation_id).single();
  if (conv?.kind !== "my_agent" || conv.created_by !== userId) return { error: "Not found." };
  const cell = meta.cells?.find((c) => c.business_id === businessId && c.point === point);
  if (!cell?.handoff || !cell.a2a_task) return cell?.status === "team_asked" ? { notice: "Already sent to the team." } : { error: "Not found." };
  const { data: exchange } = await db.from("task_exchanges").select("id, to_agent, response").eq("a2a_task_id", cell.a2a_task).eq("from_agent", agent.id).maybeSingle();
  const offer = HandoffOfferSchema.safeParse((exchange?.response as { data?: unknown } | null)?.data);
  if (!exchange?.to_agent || exchange.to_agent !== businessId || !offer.success) return { error: "Not found." };
  const sent = await handOff(agent, exchange.id, businessId, offer.data.question);
  if ("error" in sent) return sent;
  const cells = meta.cells!.map((c) => (c === cell ? { ...c, status: "team_asked", handoff: false } : c));
  await db.from("messages").update({ metadata: asJson({ ...meta, cells }) }).eq("id", messageId);
  return { notice: sent.created ? "Sent to the team. Their answer will appear on the card." : "This question has already been sent to the team." };
}

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
  const sent = await handOff(agent, exchange.id, exchange.to_agent, offer.data.question);
  if ("error" in sent) return sent;
  // Keep offers private in shared chats: UI state belongs to the original asker.
  const notice = sent.created
    ? inGroup ? `Sent to the team. They'll reply in your private chat with @${(await getAgentById(exchange.to_agent))?.handle ?? "the business"}.` : "Sent to the team. They'll reply in this conversation."
    : "This question has already been sent to the team. Their answer belongs to the original request.";
  await db.from("messages").update({ metadata: asJson({ ...meta, handoff_sent: true }) }).eq("id", messageId);
  return { notice };
}
