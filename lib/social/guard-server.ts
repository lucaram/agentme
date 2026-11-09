import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { describeRetry, hit, type LimitName } from "@/lib/limits";
import { checkCommunityMessage, trustLevel, type GuardResult, type TrustLevel } from "./guard";

const SLOW_MODE_LIMIT: Record<Exclude<TrustLevel, "moderator">, LimitName> = {
  new: "communityPostsNew",
  member: "communityPostsMember",
  trusted: "communityPostsTrusted",
};

/** The sender's standing in this community, from their own history there. */
export async function communityTrust(communityId: string, userId: string): Promise<TrustLevel> {
  const db = adminClient();
  const [{ data: member }, { data: channels }] = await Promise.all([
    db.from("community_members").select("role, joined_at").eq("community_id", communityId).eq("user_id", userId).maybeSingle(),
    db.from("conversations").select("id").eq("community_id", communityId),
  ]);
  if (!member) return "new";
  const ids = (channels ?? []).map((c) => c.id);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [{ count: messages }, { count: removed }] = await Promise.all([
    db.from("messages").select("*", { count: "exact", head: true }).in("conversation_id", ids).eq("sender_user_id", userId).is("removed_at", null),
    db.from("messages").select("*", { count: "exact", head: true }).in("conversation_id", ids).eq("sender_user_id", userId).gt("removed_at", monthAgo),
  ]);
  return trustLevel({ role: member.role, joinedAt: member.joined_at, messages: messages ?? 0, removedRecently: removed ?? 0, now: Date.now() });
}

/**
 * Before posting in a community chat: slow mode by trust level, then the
 * checks (links, mentions, repeats). Returns flags to keep on the message.
 */
export async function guardCommunityPost(communityId: string, userId: string, text: string): Promise<GuardResult> {
  const level = await communityTrust(communityId, userId);
  if (level !== "moderator") {
    const limit = await hit(SLOW_MODE_LIMIT[level], `${communityId}:${userId}`);
    if (!limit.allowed) return { ok: false, error: `Slow mode: please wait ${describeRetry(limit.retryAfterSeconds)} before posting again.` };
  }
  const db = adminClient();
  const { data: channels } = await db.from("conversations").select("id").eq("community_id", communityId);
  const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: recent } = await db
    .from("messages")
    .select("content")
    .in("conversation_id", (channels ?? []).map((c) => c.id))
    .eq("sender_user_id", userId)
    .gt("created_at", tenMinutesAgo)
    .limit(20);
  return checkCommunityMessage(text, level, (recent ?? []).map((m) => m.content));
}
