"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAgent } from "@/lib/auth";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import * as groups from "@/lib/social/groups";
import * as communities from "@/lib/social/communities";
import * as businesses from "@/lib/social/businesses";
import * as appeals from "@/lib/social/appeals";
import { dismissNotices } from "@/lib/social/notices";
import {
  communityMembership,
  createJoinLink,
  dismissReport,
  groupRole,
  isGroupAdmin,
  isModerator,
  loadJoinLink,
  removeMessage,
  reportMessage,
  revokeJoinLinks,
} from "@/lib/social/shared";

type Out = { error?: string };
const Id = z.uuid();
const ids = (list: unknown) => (Array.isArray(list) ? list.filter((x): x is string => typeof x === "string" && Id.safeParse(x).success) : []);
const me = async () => {
  const { user, agent } = await requireAgent();
  return { userId: user.id, agent };
};
const done = (paths: string[], result: { ok: boolean; error?: string }): Out => {
  for (const p of paths) revalidatePath(p);
  return result.ok ? {} : { error: result.error };
};

// ------------------------------------------------------------- groups

export async function createGroupAction(_prev: Out | undefined, form: FormData): Promise<Out> {
  const result = await groups.createGroup(await me(), {
    title: String(form.get("title") ?? ""),
    description: String(form.get("description") ?? ""),
    avatar: String(form.get("avatar") ?? ""),
    memberAgentIds: ids(form.getAll("members")),
  });
  if (!result.ok) return { error: result.error };
  revalidatePath("/groups");
  redirect(`/groups/${result.id}`);
}

export async function addMembersAction(groupId: string, agentIds: string[]): Promise<Out & { note?: string }> {
  const result = await groups.addMembers(groupId, await me(), ids(agentIds));
  revalidatePath(`/groups/${groupId}`);
  if (!result.ok) return { error: result.error };
  const parts = [result.added && `${result.added} added`, result.invited && `${result.invited} invited (they approve joining groups)`, result.skipped && `${result.skipped} couldn't be added`].filter(Boolean);
  return { note: parts.join(" · ") };
}

export async function removeMemberAction(groupId: string, userId: string) {
  return done([`/groups/${groupId}`], await groups.removeMember(groupId, await me(), userId));
}

export async function setGroupRoleAction(groupId: string, userId: string, role: "admin" | "member") {
  return done([`/groups/${groupId}`], await groups.setMemberRole(groupId, await me(), userId, role === "admin" ? "admin" : "member"));
}

export async function updateGroupInfoAction(groupId: string, _prev: Out | undefined, form: FormData): Promise<Out> {
  const result = await groups.updateGroupInfo(groupId, await me(), {
    title: String(form.get("title") ?? ""),
    description: String(form.get("description") ?? ""),
    avatar: String(form.get("avatar") ?? ""),
  });
  return done([`/groups/${groupId}`, "/groups", "/chats"], result);
}

export async function updateGroupSettingsAction(groupId: string, settings: { only_admins_send: boolean; only_admins_edit: boolean; approve_new_members: boolean }) {
  const clean = { only_admins_send: Boolean(settings.only_admins_send), only_admins_edit: Boolean(settings.only_admins_edit), approve_new_members: Boolean(settings.approve_new_members) };
  return done([`/groups/${groupId}`], await groups.updateGroupSettings(groupId, await me(), clean));
}

export async function setMutedAction(conversationId: string, muted: boolean) {
  const { userId } = await me();
  return done(["/chats", "/groups", `/groups/${conversationId}`, `/chats/${conversationId}`], await groups.setMuted(conversationId, userId, Boolean(muted)));
}

export async function blockGroupAction(groupId: string) {
  const result = await groups.blockGroup(groupId, await me());
  if (!result.ok) return { error: result.error };
  revalidatePath("/groups");
  redirect("/groups");
}

export async function reportGroupAction(groupId: string, reason: string, leave: boolean) {
  const result = await groups.reportGroup(groupId, await me(), String(reason ?? ""));
  if (!result.ok) return { error: result.error };
  if (leave) return blockGroupAction(groupId);
  return {};
}

export async function deleteGroupAction(groupId: string) {
  const result = await groups.deleteGroup(groupId, await me());
  if (!result.ok) return { error: result.error };
  revalidatePath("/groups");
  redirect("/groups");
}

export async function groupLinkAction(groupId: string): Promise<Out & { url?: string }> {
  const { userId } = await me();
  if (!isGroupAdmin(await groupRole(groupId, userId))) return { error: "Only admins can share an invite link." };
  return { url: await createJoinLink({ conversationId: groupId }, userId) };
}

export async function revokeGroupLinkAction(groupId: string): Promise<Out> {
  const { userId } = await me();
  if (!isGroupAdmin(await groupRole(groupId, userId))) return { error: "Not allowed." };
  await revokeJoinLinks({ conversationId: groupId });
  return {};
}

export async function answerGroupInviteAction(itemId: string, accept: boolean): Promise<Out> {
  const who = await me();
  const result = await groups.answerGroupInvite(itemId, who, Boolean(accept));
  revalidatePath("/chats", "layout");
  revalidatePath("/groups");
  if (!result.ok) return { error: result.error };
  if (result.id) redirect(`/chats/${result.id}`);
  return {};
}

/** Approve or decline someone asking to join a group or community. */
export async function decideRequestAction(requestId: string, approve: boolean): Promise<Out> {
  const who = await me();
  const { data: req } = await adminClient().from("join_requests").select("conversation_id, community_id").eq("id", requestId).maybeSingle();
  if (!req) return { error: "Not found." };
  const result = req.conversation_id ? await groups.decideGroupRequest(requestId, who, Boolean(approve)) : await communities.decideCommunityRequest(requestId, who, Boolean(approve));
  return done([req.conversation_id ? `/groups/${req.conversation_id}` : `/communities/${req.community_id}`], result);
}

// ------------------------------------------------------------- messages (groups & communities)

export async function reportMessageAction(messageId: string, reason: string): Promise<Out> {
  const { userId } = await me();
  const result = await reportMessage(messageId, userId, String(reason ?? ""));
  return result.ok ? {} : { error: result.error };
}

export async function removeMessageAction(messageId: string, conversationId: string): Promise<Out> {
  const { userId } = await me();
  return done([`/chats/${conversationId}`], await removeMessage(messageId, userId));
}

export async function dismissReportAction(reportId: string, path: string): Promise<Out> {
  const { userId } = await me();
  return done([path], await dismissReport(reportId, userId));
}

// ------------------------------------------------------------- communities

const communityInput = (form: FormData) => ({
  name: String(form.get("name") ?? ""),
  description: String(form.get("description") ?? ""),
  // Picked from the list (the three core rules are always there).
  houseRules: form.getAll("house_rules").map(String),
  language: String(form.get("language") ?? "") || null,
  avatar: String(form.get("avatar") ?? ""),
  visibility: form.get("visibility") === "private" ? ("private" as const) : ("public" as const),
});

export async function createCommunityAction(_prev: Out | undefined, form: FormData): Promise<Out> {
  const result = await communities.createCommunity(await me(), communityInput(form));
  if (!result.ok) return { error: result.error };
  revalidatePath("/communities");
  redirect(`/communities/${result.id}`);
}

export async function joinCommunityAction(id: string, acceptRules: boolean, viaLink?: string): Promise<Out & { status?: string }> {
  const result = await communities.joinCommunity(id, await me(), { acceptRules: Boolean(acceptRules), viaLink });
  revalidatePath(`/communities/${id}`);
  revalidatePath("/communities");
  revalidatePath("/chats");
  return result.ok ? { status: result.status } : { error: result.error };
}

export async function leaveCommunityAction(id: string): Promise<Out> {
  const result = await communities.leaveCommunity(id, await me());
  if (!result.ok) return { error: result.error };
  revalidatePath("/communities");
  redirect("/communities");
}

export async function setCommunityRoleAction(id: string, userId: string, role: "moderator" | "member" | "owner") {
  return done([`/communities/${id}`], await communities.setCommunityRole(id, await me(), userId, role));
}

export async function removeFromCommunityAction(id: string, userId: string, ban: boolean, reason: string) {
  return done([`/communities/${id}`], await communities.removeFromCommunity(id, await me(), userId, Boolean(ban), String(reason ?? "")));
}

export async function unbanAction(id: string, userId: string) {
  return done([`/communities/${id}`], await communities.unban(id, await me(), userId));
}

export async function muteMemberAction(id: string, userId: string, hours: number) {
  return done([`/communities/${id}`], await communities.muteInCommunity(id, await me(), userId, Number(hours) || 0));
}

export async function updateCommunityAction(id: string, _prev: Out | undefined, form: FormData): Promise<Out> {
  return done([`/communities/${id}`, "/communities", "/chats"], await communities.updateCommunity(id, await me(), communityInput(form)));
}

export async function deleteCommunityAction(id: string): Promise<Out> {
  const result = await communities.deleteCommunity(id, await me());
  if (!result.ok) return { error: result.error };
  revalidatePath("/communities");
  redirect("/communities");
}

export async function communityLinkAction(id: string): Promise<Out & { url?: string }> {
  const { userId } = await me();
  if (!isModerator((await communityMembership(id, userId))?.role)) return { error: "Only moderators can share an invite link." };
  return { url: await createJoinLink({ communityId: id }, userId) };
}

export async function revokeCommunityLinkAction(id: string): Promise<Out> {
  const { userId } = await me();
  if (!isModerator((await communityMembership(id, userId))?.role)) return { error: "Not allowed." };
  await revokeJoinLinks({ communityId: id });
  return {};
}

// ------------------------------------------------------------- invite links

/** Opened /invite/<token>: join the group or community it belongs to. */
export async function joinWithLinkAction(token: string, acceptRules: boolean): Promise<Out & { status?: string }> {
  const who = await me();
  const link = await loadJoinLink(String(token ?? ""));
  if (!link) return { error: "This link doesn't work any more." };
  if (link.conversation_id) {
    const result = await groups.joinGroupWithLink(token, who);
    if (!result.ok) return { error: result.error };
    if (result.status !== "requested") redirect(`/chats/${result.id}`);
    return { status: "requested" };
  }
  const result = await communities.joinCommunity(link.community_id!, who, { acceptRules: Boolean(acceptRules), viaLink: token });
  if (!result.ok) return { error: result.error };
  redirect(`/communities/${link.community_id}`);
}

// ------------------------------------------------------------- updates (tab badges)

/** The person opened Groups/Communities: their updates there are seen (database clock, own rows only). */
export async function markNoticesSeenAction(area: "groups" | "communities"): Promise<Out> {
  await requireAgent();
  if (area !== "groups" && area !== "communities") return {};
  const supabase = await createClient();
  await supabase.rpc("mark_notices_seen", { p_area: area });
  return {};
}

// ------------------------------------------------------------- businesses in groups and communities

export async function addBusinessToGroupAction(groupId: string, handle: string): Promise<Out> {
  return done([`/groups/${groupId}`], await businesses.addBusinessToGroup(groupId, await me(), String(handle ?? "")));
}

export async function removeBusinessFromGroupAction(groupId: string, businessAgentId: string): Promise<Out> {
  return done([`/groups/${groupId}`], await businesses.removeBusinessFromGroup(groupId, await me(), businessAgentId));
}

export async function invitePartnerAction(communityId: string, handle: string): Promise<Out> {
  return done([`/communities/${communityId}`], await businesses.invitePartner(communityId, await me(), String(handle ?? "")));
}

export async function removePartnerAction(communityId: string, businessAgentId: string): Promise<Out> {
  return done([`/communities/${communityId}`], await businesses.removePartner(communityId, await me(), businessAgentId));
}

/** The business's side (My Business): accept or decline a partner invitation, or leave. */
export async function answerPartnerInviteAction(placementId: string, accept: boolean): Promise<Out> {
  return done(["/business"], await businesses.answerPartnerInvite(placementId, await me(), Boolean(accept)));
}

export async function leavePlacementAction(placementId: string): Promise<Out> {
  return done(["/business"], await businesses.leavePlacement(placementId, await me()));
}

/** Search box for "Add a business" / "Invite a partner": businesses that answer anyone. */
export async function searchBusinessesAction(query: string, exclude: string[]): Promise<businesses.BusinessHit[]> {
  await requireAgent();
  return businesses.searchBusinesses(String(query ?? ""), ids(exclude));
}

// ------------------------------------------------------------- community autopilot: appeals

/** The author appeals something the community's agent did (a message not posted, or hidden). */
export async function appealAction(eventId: string): Promise<Out> {
  const { userId } = await me();
  if (!Id.safeParse(eventId).success) return { error: "Not found." };
  return done(["/communities", "/chats"], await appeals.appeal(eventId, userId));
}

/** Appeal a hidden message from the chat (its event is looked up on the server). */
export async function appealHiddenMessageAction(messageId: string, conversationId: string): Promise<Out> {
  const { userId } = await me();
  if (!Id.safeParse(messageId).success) return { error: "Not found." };
  const { data } = await adminClient().from("moderation_events").select("id").eq("message_id", messageId).eq("user_id", userId).eq("action", "hidden_after_reports").maybeSingle();
  if (!data) return { error: "Not found." };
  return done([`/chats/${conversationId}`], await appeals.appeal(data.id, userId));
}

/** A moderator accepts (or undoes) / rejects what the agent did. */
export async function resolveAppealAction(eventId: string, communityId: string, accept: boolean): Promise<Out> {
  const { userId } = await me();
  if (!Id.safeParse(eventId).success) return { error: "Not found." };
  return done([`/communities/${communityId}`], await appeals.resolveAppeal(eventId, userId, Boolean(accept)));
}

// ------------------------------------------------------------- updates (notices)

/** Clear one update (✕) or all of them in a tab ("Clear all"). */
export async function dismissNoticeAction(area: "groups" | "communities", id?: string): Promise<Out> {
  const { userId } = await me();
  if (area !== "groups" && area !== "communities") return { error: "Not found." };
  if (id && !Id.safeParse(id).success) return { error: "Not found." };
  await dismissNotices(userId, area, id);
  revalidatePath(`/${area}`);
  revalidatePath(`/updates/${area}`);
  return {};
}
