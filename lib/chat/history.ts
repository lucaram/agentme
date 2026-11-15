import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { AgentRow } from "@/lib/data/agents";
import { canPost, communityMembership, groupRole, isGroupAdmin, isModerator, type ConvRow } from "@/lib/social/shared";
import { dmState } from "@/lib/people/dm";
import { currentChatActions } from "@/lib/business/current-actions";
import { waysOf } from "@/lib/business/booking";
import { ReceiptSchema } from "./receipts";
import { ReactionSummary } from "./reactions";
import { EMPTY_HISTORY, type HistoryBundle, type HistoryPage, type HistoryRequest } from "./history-types";

type Client = SupabaseClient<Database>;
type Conversation = Database["public"]["Tables"]["conversations"]["Row"];
type Meta = { task_id?: string; proposal_id?: string; step_id?: string; booking_business_id?: string; booking_ways?: unknown };
const unique = (ids: (string | null | undefined)[]) => [...new Set(ids.filter((id): id is string => Boolean(id)))];

export async function historyPage(client: Client, conversationId: string, threadId: string | null, request: HistoryRequest): Promise<HistoryPage> {
  const { data, error } = await client.rpc("chat_history_page", { p_conversation: conversationId, p_thread: threadId, p_mode: request.mode, p_anchor: request.anchor ?? null, p_ids: request.ids ?? [] });
  if (error || !data) throw new Error("Couldn't load this conversation.");
  return data as unknown as HistoryPage;
}

/** Every table read uses the caller's RLS session. Only published business actions use their existing resolver. */
export async function prepareHistory(client: Client, userId: string, agent: AgentRow, conv: Conversation, threadId: string | null, page: HistoryPage = EMPTY_HISTORY): Promise<HistoryBundle> {
  const messages = page.messages;
  const metas = messages.map((m) => m.metadata as Meta);
  const taskIds = unique(metas.map((m) => m.task_id)); const proposalIds = unique(metas.map((m) => m.proposal_id));
  const quoteIds = unique(messages.map((m) => m.reply_to));
  const [{ data: attachments }, { data: tasks }, { data: exchanges }, { data: proposals }, { data: facts }, { data: quotes }] = await Promise.all([
    messages.length ? client.from("chat_attachments").select("id,message_id,name,mime,kind,bytes").in("message_id", messages.map((m) => m.id)) : { data: [] },
    taskIds.length ? client.from("tasks").select("*").in("id", taskIds) : { data: [] },
    taskIds.length ? client.from("task_exchanges").select("*").in("task_id", taskIds).order("created_at") : { data: [] },
    proposalIds.length ? client.from("proposals").select("*").in("id", proposalIds) : { data: [] },
    client.from("agent_facts").select("*"),
    quoteIds.length ? client.from("messages").select("*").eq("conversation_id", conv.id).in("id", quoteIds) : { data: [] },
  ]);
  const planIds = unique([...taskIds, ...(proposals ?? []).map((p) => p.task_id)]);
  const { data: steps } = planIds.length ? await client.from("plan_steps").select("*").in("task_id", planIds) : { data: [] };
  const stepIds = (steps ?? []).map((s) => s.id);
  const [{ data: responses }, { data: claims }, { data: reactionData }] = await Promise.all([
    stepIds.length ? client.from("step_responses").select("*").in("step_id", stepIds) : { data: [] },
    stepIds.length ? client.from("item_claims").select("*").in("step_id", stepIds) : { data: [] },
    messages.length ? client.rpc("get_message_reactions", { p_ids: messages.map((m) => m.id) }) : { data: [] },
  ]);
  const actors = [...messages, ...(quotes ?? [])];
  const actorIds = unique([agent.id, ...actors.map((m) => m.sender_agent_id), ...(tasks ?? []).map((t) => t.initiator_agent), ...(exchanges ?? []).flatMap((e) => [e.from_agent, e.to_agent]), ...(responses ?? []).map((r) => r.agent_id), ...(claims ?? []).map((r) => r.agent_id)]);
  const ownerIds = unique([userId, ...actors.map((m) => m.sender_user_id)]);
  const handles = unique([...(tasks ?? []).map((t) => t.parsed), ...(proposals ?? []).map((p) => p.content), ...(steps ?? []).map((s) => s.config)].flatMap((value) => { const v = value as { participants?: string[]; voters?: string[] }; return [...(v.participants ?? []), ...(v.voters ?? [])]; })).filter((h) => /^[a-z0-9_-]{1,64}$/i.test(h));
  const { data: agents } = await client.from("agents").select("id,owner_id,handle,display_name,avatar,type,verified_domain").or(`id.in.(${actorIds.join(",")}),owner_id.in.(${ownerIds.join(",")})${handles.length ? `,handle.in.(${handles.join(",")})` : ""}`);
  const ownedAgentIds = new Set((agents ?? []).filter((a) => a.owner_id === userId).map((a) => a.id));
  const receiptIds = messages.filter((m) => !m.removed_at && !m.visible_to && (m.sender_user_id === userId || (["dm", "group", "channel"].includes(conv.kind) && m.sender_agent_id && ownedAgentIds.has(m.sender_agent_id)))).map((m) => m.id);
  const { data: receiptData } = receiptIds.length ? await client.rpc("get_message_receipts", { p_ids: receiptIds }) : { data: [] };
  const venueIds = unique((proposals ?? []).map((p) => (p.content as { venue?: { agent_id?: string } }).venue?.agent_id));
  const booking = conv.kind === "my_agent" ? messages.flatMap((m) => {
    const meta = m.metadata as Meta;
    return m.is_ai_generated && !m.removed_at && Array.isArray(meta.booking_ways) ? [{ messageId: m.id, businessId: meta.booking_business_id, ways: waysOf({ ways: meta.booking_ways }), metadata: m.metadata }] : [];
  }) : [];
  const actions = await currentChatActions([...venueIds, ...booking.flatMap((m) => m.businessId ? [m.businessId] : [])], booking.filter((m) => !m.businessId));
  const shared = conv.kind === "group" || conv.kind === "channel";
  const posting = shared ? await canPost(conv as ConvRow, userId) : { ok: true };
  const dm = conv.kind === "dm" ? await dmState(conv.id, userId, agent.id) : null;
  const canModerate = conv.kind === "group" ? isGroupAdmin(await groupRole(conv.id, userId)) : conv.kind === "channel" && conv.community_id ? isModerator((await communityMembership(conv.community_id, userId))?.role) : false;
  const { data: suspended } = await client.rpc("space_is_suspended", { p_conversation: conv.id });
  return { ...page, revision: crypto.randomUUID(), userId, agent: { id: agent.id, handle: agent.handle }, conversationId: conv.id, threadId, kind: conv.kind, suspended: Boolean(suspended), reactions: ReactionSummary.array().safeParse(reactionData).data ?? [],
    canReplyHere: posting.ok && (!dm || dm.state === "open"), canModerate, agents: agents ?? [], attachments: attachments ?? [], tasks: tasks ?? [], exchanges: exchanges ?? [], proposals: proposals ?? [], steps: steps ?? [], responses: responses ?? [], claims: claims ?? [], facts: facts ?? [], quotes: quotes ?? [], receipts: ReceiptSchema.array().safeParse(receiptData).data ?? [], actions: [...actions.actions], legacy: [...actions.legacyIdentities] };
}
