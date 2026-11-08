import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { getAgentByHandle, getAgentById, type AgentRow } from "@/lib/data/agents";
import { postMessage } from "@/lib/data/chat";
import { sendAgentMessage } from "@/lib/a2a/client";
import { tellOwner } from "@/lib/requests/notify";
import { hit } from "@/lib/limits";
import { communityMembership, groupRole, isGroupAdmin, isModerator, type Result } from "./shared";

/**
 * Businesses in groups and communities. A business is never a member: it's
 * placed there, sees only the messages that @mention it (the server sends it
 * just that message), answers from its public information only, and never
 * posts on its own.
 */
type Me = { userId: string; agent: AgentRow };
export const MAX_BUSINESSES_PER_PLACE = 5;
/** Businesses answered per message (the rest are ignored). */
const MAX_MENTIONED = 2;

const note = (conversationId: string, content: string) => postMessage({ conversationId, from: "system", content, metadata: { kind: "event" } });
const cleanHandle = (raw: string) => raw.trim().replace(/^@/, "").toLowerCase();

/** A business that can be placed somewhere: answers anyone's questions. */
async function placeableBusiness(handle: string): Promise<Result<{ business: AgentRow }>> {
  const business = await getAgentByHandle(cleanHandle(handle));
  if (!business || business.type !== "business") return { ok: false, error: "No business with that @address." };
  if (business.contact_policy !== "anyone") return { ok: false, error: `${business.display_name} only talks to its own customers, so it can't be added.` };
  return { ok: true, business };
}

async function placementsCount(column: "conversation_id" | "community_id", id: string) {
  const { count } = await adminClient().from("business_placements").select("*", { count: "exact", head: true }).eq(column, id);
  return count ?? 0;
}

export type BusinessHit = { id: string; handle: string; display_name: string; avatar: string; bio: string | null };

/** Businesses that can be added (they answer anyone), by name or @address. */
export async function searchBusinesses(query: string, exclude: string[] = []): Promise<BusinessHit[]> {
  // Letters, digits, spaces and a few name characters only: nothing that can change the filter.
  const q = query.trim().replace(/^@/, "").replace(/[^\p{L}\p{N} _'&.-]/gu, "").slice(0, 40);
  if (q.length < 2) return [];
  const like = q.replace(/_/g, "\\_");
  const { data } = await adminClient()
    .from("agents")
    .select("id, handle, display_name, avatar, bio")
    .eq("type", "business")
    .eq("contact_policy", "anyone")
    .or(`handle.ilike.${like}%,display_name.ilike.%${like}%`)
    .order("display_name")
    .limit(12);
  return (data ?? []).filter((b) => !exclude.includes(b.id)).slice(0, 8);
}

// ------------------------------------------------------------- groups

/** Group admins add a business; it's there straight away (the business can leave). */
export async function addBusinessToGroup(groupId: string, me: Me, handle: string): Promise<Result> {
  const db = adminClient();
  const { data: group } = await db.from("conversations").select("id, title").eq("id", groupId).eq("kind", "group").maybeSingle();
  if (!group || !isGroupAdmin(await groupRole(groupId, me.userId))) return { ok: false, error: "Only admins can add a business." };
  const found = await placeableBusiness(handle);
  if (!found.ok) return found;
  const { business } = found;
  if ((await placementsCount("conversation_id", groupId)) >= MAX_BUSINESSES_PER_PLACE) return { ok: false, error: `A group can have up to ${MAX_BUSINESSES_PER_PLACE} businesses.` };
  const { error } = await db.from("business_placements").insert({ business_agent_id: business.id, conversation_id: groupId, added_by: me.userId });
  if (error) return { ok: false, error: error.code === "23505" ? `${business.display_name} is already in this group.` : "Couldn't add the business." };
  await note(
    groupId,
    `${me.agent.display_name} added ${business.avatar} ${business.display_name} (business). Mention @${business.handle} to ask it something: it only sees messages that mention it, answers from its public information and never posts on its own. Anyone can remove it.`,
  );
  await tellOwner(
    business.owner_id,
    business.id,
    `👥 ${me.agent.display_name} added ${business.display_name} to the group “${group.title ?? "Group"}”. I'll answer there only when someone mentions @${business.handle}, and only from your public information. You can leave it from My Business.`,
  );
  return { ok: true };
}

/** Anyone in the group can remove a business. */
export async function removeBusinessFromGroup(groupId: string, me: Me, businessAgentId: string): Promise<Result> {
  if (!(await groupRole(groupId, me.userId))) return { ok: false, error: "Not found." };
  const db = adminClient();
  const { data: removed } = await db.from("business_placements").delete().eq("conversation_id", groupId).eq("business_agent_id", businessAgentId).select("id");
  if (!removed?.length) return { ok: false, error: "That business isn't in this group." };
  const business = await getAgentById(businessAgentId);
  if (business) await note(groupId, `${me.agent.display_name} removed ${business.display_name} from the group.`);
  return { ok: true };
}

// ------------------------------------------------------------- communities

/** Moderators invite a business as an official partner; it's listed once the business accepts. */
export async function invitePartner(communityId: string, me: Me, handle: string): Promise<Result> {
  const db = adminClient();
  const { data: community } = await db.from("communities").select("id, name").eq("id", communityId).maybeSingle();
  if (!community || !isModerator((await communityMembership(communityId, me.userId))?.role)) return { ok: false, error: "Only moderators can invite partners." };
  const found = await placeableBusiness(handle);
  if (!found.ok) return found;
  const { business } = found;
  if ((await placementsCount("community_id", communityId)) >= MAX_BUSINESSES_PER_PLACE) return { ok: false, error: `A community can have up to ${MAX_BUSINESSES_PER_PLACE} partners.` };
  const { error } = await db.from("business_placements").insert({ business_agent_id: business.id, community_id: communityId, status: "invited", added_by: me.userId });
  if (error) return { ok: false, error: error.code === "23505" ? `${business.display_name} is already a partner or invited.` : "Couldn't send the invitation." };
  await tellOwner(
    business.owner_id,
    business.id,
    `🤝 ${me.agent.display_name} invited ${business.display_name} to be an official partner of the community “${community.name}”. If you accept, members can mention @${business.handle} in its chats and I'll answer from your public information. Accept or decline in My Business.`,
  );
  return { ok: true };
}

export async function removePartner(communityId: string, me: Me, businessAgentId: string): Promise<Result> {
  if (!isModerator((await communityMembership(communityId, me.userId))?.role)) return { ok: false, error: "Only moderators can remove partners." };
  const { data: removed } = await adminClient().from("business_placements").delete().eq("community_id", communityId).eq("business_agent_id", businessAgentId).select("id");
  return removed?.length ? { ok: true } : { ok: false, error: "Not found." };
}

async function generalChannel(communityId: string) {
  const { data } = await adminClient().from("conversations").select("id").eq("community_id", communityId).eq("channel", "general").maybeSingle();
  return data?.id ?? null;
}

// ------------------------------------------------------------- the business's side

/** The business accepts or declines a partner invitation. */
export async function answerPartnerInvite(placementId: string, me: Me, accept: boolean): Promise<Result> {
  const db = adminClient();
  const { data: placement } = await db.from("business_placements").select("*").eq("id", placementId).eq("business_agent_id", me.agent.id).eq("status", "invited").maybeSingle();
  if (!placement?.community_id) return { ok: false, error: "This invitation is no longer open." };
  if (!accept) {
    await db.from("business_placements").delete().eq("id", placementId);
    return { ok: true };
  }
  await db.from("business_placements").update({ status: "active" }).eq("id", placementId);
  const general = await generalChannel(placement.community_id);
  if (general) {
    await note(general, `🤝 ${me.agent.avatar} ${me.agent.display_name} is now an official partner. Mention @${me.agent.handle} to ask it something: it only sees messages that mention it and never posts on its own.`);
  }
  return { ok: true };
}

/** The business leaves a group or community it was placed in. */
export async function leavePlacement(placementId: string, me: Me): Promise<Result> {
  const db = adminClient();
  const { data: placement } = await db.from("business_placements").delete().eq("id", placementId).eq("business_agent_id", me.agent.id).select("*").maybeSingle();
  if (!placement) return { ok: false, error: "Not found." };
  if (placement.conversation_id) await note(placement.conversation_id, `${me.agent.display_name} (business) left the group.`);
  return { ok: true };
}

// ------------------------------------------------------------- mentions

/** "@handle" mentions in a message (lower-case handles, without "@agent"). */
export function mentionedHandles(text: string): string[] {
  const found = [...text.matchAll(/(^|[^a-z0-9_@])@([a-z0-9_]{3,20})(?![a-z0-9_])/gi)].map((m) => m[2].toLowerCase());
  return [...new Set(found)].filter((h) => h !== "agent");
}

/**
 * Someone mentioned businesses placed in this group or community chat: each
 * mentioned business is sent just that message (over A2A, as the sender's
 * agent) and its answer is posted for everyone. Public information only,
 * whatever the sender's relationship with the business, since everyone here
 * reads the answer.
 */
export async function answerMentions(opts: {
  conversation: { id: string; kind: string; community_id: string | null };
  userId: string;
  agent: AgentRow;
  text: string;
}): Promise<void> {
  const { conversation, userId, agent, text } = opts;
  const handles = mentionedHandles(text);
  if (!handles.length) return;
  const db = adminClient();
  const where =
    conversation.kind === "group" ? { column: "conversation_id" as const, id: conversation.id }
    : conversation.kind === "channel" && conversation.community_id ? { column: "community_id" as const, id: conversation.community_id }
    : null;
  if (!where) return;
  const { data: placements } = await db.from("business_placements").select("business_agent_id").eq(where.column, where.id).eq("status", "active");
  if (!placements?.length) return;
  const { data: businesses } = await db
    .from("agents")
    .select("id, handle, display_name")
    .in("id", placements.map((p) => p.business_agent_id))
    .in("handle", handles);
  const asked = (businesses ?? []).slice(0, MAX_MENTIONED);
  if (!asked.length) return;

  const privately = (content: string) => postMessage({ conversationId: conversation.id, from: "system", content, visibleTo: userId, metadata: { kind: "error" } });
  const limit = await hit("businessMentionsPerUser", userId);
  if (!limit.allowed) {
    await privately("You're asking businesses here too often. Try again later, or ask them directly from their page.");
    return;
  }
  await Promise.all(
    asked.map(async (business) => {
      const result = await sendAgentMessage({ fromAgentId: agent.id, toHandle: business.handle, text, data: { audience: "public", context: "group" } });
      if (!result.ok) {
        await privately(`${business.display_name} couldn't answer right now: ${result.error}`);
        return;
      }
      await postMessage({
        conversationId: conversation.id,
        from: "agent",
        agentId: business.id,
        content: result.text || "(no answer)",
        metadata: { kind: "business_reply", asked_by: userId },
      });
    }),
  );
}
