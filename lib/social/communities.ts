import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { getAgentForUser, type AgentRow } from "@/lib/data/agents";
import { createConversation, postMessage } from "@/lib/data/chat";
import { COMMUNITY_AVATARS, MAX_COMMUNITY_PEOPLE, communityMembership, isModerator, loadJoinLink, notify, type Result } from "./shared";

type Me = { userId: string; agent: AgentRow };
export type CommunityInput = { name: string; description: string; rules: string; avatar: string; visibility: "public" | "private" };

async function loadCommunity(id: string) {
  const { data } = await adminClient().from("communities").select("*").eq("id", id).maybeSingle();
  return data;
}

async function channels(communityId: string) {
  const { data } = await adminClient().from("conversations").select("id, channel").eq("community_id", communityId);
  return data ?? [];
}

function clean(input: CommunityInput) {
  return {
    name: input.name.trim().replace(/\s+/g, " ").slice(0, 60),
    description: input.description.trim().slice(0, 500) || null,
    rules: input.rules.trim().slice(0, 2000) || null,
    avatar: COMMUNITY_AVATARS.includes(input.avatar) ? input.avatar : "🏟️",
    visibility: input.visibility === "private" ? ("private" as const) : ("public" as const),
  };
}

/** Adds someone to the community and both of its chats. */
async function addMember(communityId: string, userId: string, role: "owner" | "moderator" | "member" = "member") {
  const db = adminClient();
  await db.from("community_members").upsert({ community_id: communityId, user_id: userId, role }, { onConflict: "community_id,user_id", ignoreDuplicates: true });
  const rows = (await channels(communityId)).map((c) => ({ conversation_id: c.id, user_id: userId }));
  if (rows.length) await db.from("conversation_members").upsert(rows, { onConflict: "conversation_id,user_id", ignoreDuplicates: true });
}

async function dropMember(communityId: string, userId: string) {
  const db = adminClient();
  await db.from("community_members").delete().eq("community_id", communityId).eq("user_id", userId);
  const ids = (await channels(communityId)).map((c) => c.id);
  if (ids.length) await db.from("conversation_members").delete().in("conversation_id", ids).eq("user_id", userId);
}

async function size(communityId: string) {
  const { count } = await adminClient().from("community_members").select("*", { count: "exact", head: true }).eq("community_id", communityId);
  return count ?? 0;
}

/** A community with two chats: Announcements (moderators post) and General (everyone). */
export async function createCommunity(me: Me, input: CommunityInput): Promise<Result<{ id: string }>> {
  if (me.agent.guest) return { ok: false, error: "Save your account first to create a community." };
  const c = clean(input);
  if (c.name.length < 3) return { ok: false, error: "The name needs at least 3 characters." };
  const db = adminClient();
  const { data: community, error } = await db.from("communities").insert({ ...c, owner_id: me.userId }).select("id").single();
  if (error || !community) return { ok: false, error: error?.code === "23505" ? "A community with that name already exists." : "Couldn't create the community." };
  for (const [channel, title] of [["announcements", "Announcements"], ["general", "General"]] as const) {
    const conv = await createConversation({ kind: "channel", title, createdBy: me.userId, memberIds: [] });
    await db.from("conversations").update({ community_id: community.id, channel }).eq("id", conv.id);
  }
  await addMember(community.id, me.userId, "owner");
  const general = (await channels(community.id)).find((ch) => ch.channel === "general");
  if (general) await postMessage({ conversationId: general.id, from: "system", content: `Welcome to ${c.name}! Be kind and follow the rules.`, metadata: { kind: "event" } });
  return { ok: true, id: community.id };
}

/**
 * Join: public communities directly (after accepting the rules); private ones
 * only with an invite link or an approved request. Banned people can't.
 */
export async function joinCommunity(id: string, me: Me, opts: { acceptRules: boolean; viaLink?: string }): Promise<Result<{ status: "joined" | "requested" | "member" }>> {
  const community = await loadCommunity(id);
  if (!community) return { ok: false, error: "Not found." };
  if (await communityMembership(id, me.userId)) return { ok: true, status: "member" };
  if (community.rules && !opts.acceptRules) return { ok: false, error: "Please accept the community rules to join." };
  const db = adminClient();
  const { data: ban } = await db.from("community_bans").select("user_id").eq("community_id", id).eq("user_id", me.userId).maybeSingle();
  if (ban) return { ok: false, error: "You can't join this community." };
  if ((await size(id)) >= MAX_COMMUNITY_PEOPLE) return { ok: false, error: "This community is full." };
  const link = opts.viaLink ? await loadJoinLink(opts.viaLink) : null;
  const invited = link?.community_id === id;
  if (community.visibility === "private" && !invited) {
    await db.from("join_requests").insert({ community_id: id, user_id: me.userId }); // a duplicate pending request is a no-op
    return { ok: true, status: "requested" };
  }
  await addMember(id, me.userId);
  return { ok: true, status: "joined" };
}

export async function leaveCommunity(id: string, me: Me): Promise<Result> {
  const m = await communityMembership(id, me.userId);
  if (!m) return { ok: true };
  if (m.role === "owner") return { ok: false, error: "Make someone else the owner first, or delete the community." };
  await dropMember(id, me.userId);
  return { ok: true };
}

/** Owner: promote/demote moderators, or hand over ownership. */
export async function setCommunityRole(id: string, me: Me, userId: string, role: "moderator" | "member" | "owner"): Promise<Result> {
  const mine = await communityMembership(id, me.userId);
  const theirs = await communityMembership(id, userId);
  if (mine?.role !== "owner" || !theirs || userId === me.userId) return { ok: false, error: "Only the owner can change roles." };
  const db = adminClient();
  if (role === "owner") {
    await db.from("community_members").update({ role: "owner" }).eq("community_id", id).eq("user_id", userId);
    await db.from("community_members").update({ role: "moderator" }).eq("community_id", id).eq("user_id", me.userId);
    await db.from("communities").update({ owner_id: userId }).eq("id", id);
    return { ok: true };
  }
  await db.from("community_members").update({ role }).eq("community_id", id).eq("user_id", userId);
  if (role === "moderator") {
    const community = await loadCommunity(id);
    await notify([userId], "communities", `⭐ You're now a moderator of ${community?.name ?? "a community"}.`, `/communities/${id}`);
  }
  return { ok: true };
}

/** Moderators remove (and optionally ban) members; only the owner can act on moderators. */
export async function removeFromCommunity(id: string, me: Me, userId: string, ban: boolean, reason: string): Promise<Result> {
  const mine = await communityMembership(id, me.userId);
  const theirs = await communityMembership(id, userId);
  if (!isModerator(mine?.role) || !theirs || userId === me.userId) return { ok: false, error: "Not allowed." };
  if (theirs.role === "owner" || (theirs.role === "moderator" && mine?.role !== "owner")) return { ok: false, error: "Only the owner can remove a moderator." };
  await dropMember(id, userId);
  const community = await loadCommunity(id);
  await notify(
    [userId],
    "communities",
    ban ? `⛔ You were removed from ${community?.name ?? "a community"} by a moderator and can't rejoin.` : `🚪 You were removed from ${community?.name ?? "a community"} by a moderator.`,
  );
  if (ban) {
    await adminClient().from("community_bans").upsert({ community_id: id, user_id: userId, banned_by: me.userId, reason: reason.trim().slice(0, 300) || null }, { onConflict: "community_id,user_id" });
  }
  return { ok: true };
}

export async function unban(id: string, me: Me, userId: string): Promise<Result> {
  if (!isModerator((await communityMembership(id, me.userId))?.role)) return { ok: false, error: "Not allowed." };
  await adminClient().from("community_bans").delete().eq("community_id", id).eq("user_id", userId);
  return { ok: true };
}

/** Moderators mute a member for some hours (0 = unmute). They can still read. */
export async function muteInCommunity(id: string, me: Me, userId: string, hours: number): Promise<Result> {
  const mine = await communityMembership(id, me.userId);
  const theirs = await communityMembership(id, userId);
  if (!isModerator(mine?.role) || !theirs || isModerator(theirs.role)) return { ok: false, error: "Not allowed." };
  const until = hours > 0 ? new Date(Date.now() + Math.min(hours, 24 * 30) * 3600_000).toISOString() : null;
  await adminClient().from("community_members").update({ muted_until: until }).eq("community_id", id).eq("user_id", userId);
  if (until) {
    const community = await loadCommunity(id);
    await notify([userId], "communities", `🔇 A moderator muted you in ${community?.name ?? "a community"} for ${hours} hours. You can still read.`, `/communities/${id}`);
  }
  return { ok: true };
}

/** Owner and moderators edit the description and rules; only the owner renames or changes visibility. */
export async function updateCommunity(id: string, me: Me, input: CommunityInput): Promise<Result> {
  const community = await loadCommunity(id);
  const role = (await communityMembership(id, me.userId))?.role;
  if (!community || !isModerator(role)) return { ok: false, error: "Not allowed." };
  const c = clean(input);
  const ownerOnly = role === "owner" ? { name: c.name.length >= 3 ? c.name : community.name, visibility: c.visibility, avatar: c.avatar } : {};
  const { error } = await adminClient().from("communities").update({ description: c.description, rules: c.rules, ...ownerOnly }).eq("id", id);
  if (error) return { ok: false, error: error.code === "23505" ? "A community with that name already exists." : "Couldn't save." };
  return { ok: true };
}

export async function deleteCommunity(id: string, me: Me): Promise<Result> {
  if ((await communityMembership(id, me.userId))?.role !== "owner") return { ok: false, error: "Only the owner can delete the community." };
  const community = await loadCommunity(id);
  const { data: members } = await adminClient().from("community_members").select("user_id").eq("community_id", id).neq("user_id", me.userId);
  await adminClient().from("communities").delete().eq("id", id); // its chats and messages go too
  await notify((members ?? []).map((m) => m.user_id), "communities", `🗑️ ${community?.name ?? "A community"} was deleted by its owner.`);
  return { ok: true };
}

export async function decideCommunityRequest(requestId: string, me: Me, approve: boolean): Promise<Result> {
  const db = adminClient();
  const { data: req } = await db.from("join_requests").select("*").eq("id", requestId).maybeSingle();
  if (!req?.community_id || req.status !== "pending" || !isModerator((await communityMembership(req.community_id, me.userId))?.role)) {
    return { ok: false, error: "Not found." };
  }
  await db.from("join_requests").update({ status: approve ? "approved" : "declined", decided_by: me.userId }).eq("id", req.id);
  if (approve) {
    if ((await size(req.community_id)) >= MAX_COMMUNITY_PEOPLE) return { ok: false, error: "The community is full." };
    await addMember(req.community_id, req.user_id);
  }
  const community = await loadCommunity(req.community_id);
  await notify(
    [req.user_id],
    "communities",
    approve ? `✅ Welcome! You're now a member of ${community?.name ?? "the community"}.` : `Your request to join ${community?.name ?? "a community"} was declined.`,
    approve ? `/communities/${req.community_id}` : null,
  );
  return { ok: true };
}

export async function displayName(userId: string) {
  return (await getAgentForUser(userId))?.display_name ?? "Someone";
}
