import "server-only";
import { hideIfReportsAgree } from "./moderation-server";
import { adminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { randomToken } from "@/lib/people/crypto";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export const MAX_GROUP_PEOPLE = 256;
export const MAX_COMMUNITY_PEOPLE = 5000;
export const GROUP_AVATARS = ["👥", "🎉", "⚽", "🍕", "🏃", "📚", "🎮", "🎵", "💼", "🏠", "✈️", "❤️"];
export const COMMUNITY_AVATARS = ["🏟️", "⚽", "🗳️", "🎮", "🎵", "📚", "🧑‍💻", "🌍", "🏃", "🍳", "🎨", "💬"];

const LINK_DAYS = 30;
export const joinUrl = (token: string) => `${env.appUrl.replace(/\/$/, "")}/invite/${token}`;

export type ConvRow = { id: string; kind: string; title: string | null; community_id: string | null; channel: string | null; only_admins_send: boolean; only_admins_edit: boolean; approve_new_members: boolean };

export async function groupRole(conversationId: string, userId: string): Promise<"owner" | "admin" | "member" | null> {
  const { data } = await adminClient().from("conversation_members").select("role").eq("conversation_id", conversationId).eq("user_id", userId).maybeSingle();
  return (data?.role as "owner" | "admin" | "member" | undefined) ?? null;
}

export async function communityMembership(communityId: string, userId: string) {
  const { data } = await adminClient().from("community_members").select("role, muted_until").eq("community_id", communityId).eq("user_id", userId).maybeSingle();
  return data as { role: "owner" | "moderator" | "member"; muted_until: string | null } | null;
}

export const isGroupAdmin = (role: string | null) => role === "owner" || role === "admin";
export const isModerator = (role: string | null | undefined) => role === "owner" || role === "moderator";

/**
 * Who may post where: groups can be "only admins can send"; a community's
 * Announcements is for its owner/moderators; members muted by a moderator
 * can read but not post until the mute ends.
 */
export async function canPost(conv: ConvRow, userId: string): Promise<Result> {
  if (conv.kind === "group" && conv.only_admins_send && !isGroupAdmin(await groupRole(conv.id, userId))) {
    return { ok: false, error: "Only admins can send messages in this group." };
  }
  if (conv.kind === "channel" && conv.community_id) {
    const m = await communityMembership(conv.community_id, userId);
    if (!m) return { ok: false, error: "Join the community to post." };
    if (conv.channel === "announcements" && !isModerator(m.role)) return { ok: false, error: "Only moderators post announcements. Chat in General." };
    if (m.muted_until && new Date(m.muted_until).getTime() > Date.now()) return { ok: false, error: "A moderator muted you for a while. You can read but not post." };
  }
  return { ok: true };
}

// ------------------------------------------------------------- invite links

export async function createJoinLink(target: { conversationId?: string; communityId?: string }, userId: string): Promise<string> {
  const db = adminClient();
  const filter = target.conversationId ? { col: "conversation_id", id: target.conversationId } : { col: "community_id", id: target.communityId! };
  const { data: existing } = await db
    .from("join_links")
    .select("token")
    .eq(filter.col, filter.id)
    .eq("revoked", false)
    .gt("expires_at", new Date(Date.now() + 24 * 3600_000).toISOString())
    .limit(1)
    .maybeSingle();
  if (existing) return joinUrl(existing.token);
  const token = randomToken();
  await db.from("join_links").insert({
    token,
    conversation_id: target.conversationId ?? null,
    community_id: target.communityId ?? null,
    created_by: userId,
    expires_at: new Date(Date.now() + LINK_DAYS * 24 * 3600_000).toISOString(),
  });
  return joinUrl(token);
}

export async function revokeJoinLinks(target: { conversationId?: string; communityId?: string }) {
  const db = adminClient();
  if (target.conversationId) await db.from("join_links").update({ revoked: true }).eq("conversation_id", target.conversationId);
  if (target.communityId) await db.from("join_links").update({ revoked: true }).eq("community_id", target.communityId);
}

export async function loadJoinLink(token: string) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  const { data } = await adminClient().from("join_links").select("*").eq("token", token).maybeSingle();
  if (!data || data.revoked || new Date(data.expires_at).getTime() < Date.now()) return null;
  return data;
}

// ------------------------------------------------------------- reports & message removal

const REMOVED = "🚫 This message was removed";

/** Report a message to the group's admins / the community's moderators. */
export async function reportMessage(messageId: string, userId: string, reason: string): Promise<Result> {
  const db = adminClient();
  const { data: msg } = await db.from("messages").select("id, conversation_id, content, visible_to, removed_at").eq("id", messageId).maybeSingle();
  if (!msg || msg.visible_to || msg.removed_at) return { ok: false, error: "Not found." };
  const { data: conv } = await db.from("conversations").select("id, kind, community_id").eq("id", msg.conversation_id).single();
  if (!conv || (conv.kind !== "group" && conv.kind !== "channel")) return { ok: false, error: "Not found." };
  const { data: member } = await db.from("conversation_members").select("user_id").eq("conversation_id", conv.id).eq("user_id", userId).maybeSingle();
  if (!member) return { ok: false, error: "Not found." };
  const text = reason.trim().slice(0, 300);
  if (!text) return { ok: false, error: "Say briefly what's wrong." };
  await db.from("reports").insert({
    reporter_id: userId,
    conversation_id: conv.id,
    community_id: conv.community_id,
    message_id: msg.id,
    excerpt: msg.content.slice(0, 500),
    reason: text,
  });
  // Community: enough different members reporting it + the AI check agreeing hides it, no moderator needed.
  if (conv.kind === "channel") await hideIfReportsAgree(msg.id);
  return { ok: true };
}

/** May this user remove this message for everyone? Their own, or as group admin / community moderator. */
async function canRemove(message: { conversation_id: string; sender_user_id: string | null }, userId: string) {
  if (message.sender_user_id === userId) return true;
  const { data: conv } = await adminClient().from("conversations").select("kind, community_id").eq("id", message.conversation_id).single();
  if (conv?.kind === "group") return isGroupAdmin(await groupRole(message.conversation_id, userId));
  if (conv?.kind === "channel" && conv.community_id) return isModerator((await communityMembership(conv.community_id, userId))?.role);
  return false;
}

export async function removeMessage(messageId: string, userId: string): Promise<Result> {
  const db = adminClient();
  const { data: msg } = await db.from("messages").select("id, conversation_id, sender_user_id, removed_at").eq("id", messageId).maybeSingle();
  if (!msg) return { ok: false, error: "Not found." };
  if (msg.removed_at) return { ok: true };
  if (!(await canRemove(msg, userId))) return { ok: false, error: "You can't remove this message." };
  const own = msg.sender_user_id === userId;
  await db
    .from("messages")
    .update({ content: own ? `${REMOVED} by its sender` : `${REMOVED} by a moderator`, removed_at: new Date().toISOString(), removed_by: userId })
    .eq("id", msg.id);
  await db.from("reports").update({ status: "resolved", resolved_by: userId }).eq("message_id", msg.id).eq("status", "open");
  return { ok: true };
}

export async function dismissReport(reportId: string, userId: string): Promise<Result> {
  const db = adminClient();
  const { data: report } = await db.from("reports").select("*").eq("id", reportId).maybeSingle();
  if (!report) return { ok: false, error: "Not found." };
  const allowed = report.community_id
    ? isModerator((await communityMembership(report.community_id, userId))?.role)
    : report.conversation_id
      ? isGroupAdmin(await groupRole(report.conversation_id, userId))
      : false;
  if (!allowed) return { ok: false, error: "Not found." };
  await db.from("reports").update({ status: "dismissed", resolved_by: userId }).eq("id", reportId);
  return { ok: true };
}

/** Is a moderator's mute still running? (Kept out of components: reading the clock isn't pure.) */
export function stillMuted(until: string | null | undefined): boolean {
  return Boolean(until && new Date(until).getTime() > Date.now());
}

/** An update shown in the Groups/Communities tab (and counted in its badge until seen). */
export async function notify(
  userIds: string[],
  area: "groups" | "communities",
  text: string,
  link: string | null = null,
  /** kind: groups repeats; needsAction: pinned at the top (with "Review") until handled. */
  opts: { kind?: string; needsAction?: boolean } = {},
) {
  // Which group or community it's about, from its link (to filter, group repeats and respect mute).
  const ref = link?.match(/^\/(?:groups|communities)\/([0-9a-f-]{36})/)?.[1] ?? null;
  const rows = [...new Set(userIds)].map((user_id) => ({
    user_id,
    area,
    text: text.slice(0, 300),
    link,
    ref_id: ref,
    kind: opts.kind ?? "info",
    needs_action: Boolean(opts.needsAction),
  }));
  for (let i = 0; i < rows.length; i += 500) await adminClient().from("notices").insert(rows.slice(i, i + 500));
}

/** "N days ago" as an ISO timestamp (kept out of components: reading the clock isn't pure). */
export function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 3600_000).toISOString();
}
