import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { postMessage } from "@/lib/data/chat";
import { communityMembership, isModerator, notify, type Result } from "./shared";

/**
 * Appeals on what the community autopilot did (a message not posted, or one
 * hidden after reports). The author appeals once; a moderator may accept or
 * reject it; if nobody answers within 3 days, it's resolved automatically:
 * accepted for members with a good history there, rejected otherwise.
 */
export const APPEAL_WAIT_HOURS = 72;
const GOOD_HISTORY = { days: 7, messages: 5 } as const;

type EventRow = {
  id: string;
  community_id: string;
  conversation_id: string | null;
  message_id: string | null;
  user_id: string | null;
  action: string;
  original_text: string | null;
  appeal_status: string | null;
};

async function loadEvent(eventId: string): Promise<EventRow | null> {
  const { data } = await adminClient()
    .from("moderation_events")
    .select("id, community_id, conversation_id, message_id, user_id, action, original_text, appeal_status")
    .eq("id", eventId)
    .maybeSingle();
  return data;
}

async function moderatorsOf(communityId: string): Promise<string[]> {
  const { data } = await adminClient().from("community_members").select("user_id").eq("community_id", communityId).in("role", ["owner", "moderator"]);
  return (data ?? []).map((m) => m.user_id);
}

/** The author asks for a second look. Only their own, only once, only for "not posted" or "hidden". */
export async function appeal(eventId: string, userId: string): Promise<Result> {
  const event = await loadEvent(eventId);
  if (!event || event.user_id !== userId || !["refused", "hidden_after_reports"].includes(event.action)) return { ok: false, error: "Not found." };
  if (event.appeal_status) return { ok: false, error: "You've already appealed this." };
  await adminClient().from("moderation_events").update({ appeal_status: "pending", appealed_at: new Date().toISOString() }).eq("id", eventId).is("appeal_status", null);
  if (event.message_id) {
    const { data: msg } = await adminClient().from("messages").select("metadata").eq("id", event.message_id).single();
    await adminClient().from("messages").update({ metadata: { ...((msg?.metadata ?? {}) as object), appeal: "pending" } }).eq("id", event.message_id);
  }
  await notify(await moderatorsOf(event.community_id), "communities", "🤖 A member appealed something the community's agent did. You can accept or reject it (optional).", `/communities/${event.community_id}`, {
    kind: "appeal",
    needsAction: true,
  });
  return { ok: true };
}

/** Accepted: post the message (if it wasn't posted) or restore it (if it was hidden). */
async function restore(event: EventRow) {
  const db = adminClient();
  if (event.action === "hidden_after_reports" && event.message_id && event.original_text) {
    await db.from("messages").update({ content: event.original_text, removed_at: null, removed_by: null, metadata: { appeal: "accepted" } }).eq("id", event.message_id);
  } else if (event.action === "refused" && event.conversation_id && event.user_id && event.original_text) {
    await postMessage({ conversationId: event.conversation_id, from: "human", userId: event.user_id, content: event.original_text, metadata: { flags: ["restored_after_appeal"] } });
  }
}

async function settle(event: EventRow, accept: boolean, by: string | null) {
  const { data: won } = await adminClient()
    .from("moderation_events")
    .update({ appeal_status: accept ? "accepted" : "rejected", appeal_resolved_at: new Date().toISOString(), appeal_resolved_by: by })
    .eq("id", event.id)
    .eq("appeal_status", "pending")
    .select("id");
  if (!won?.length) return; // someone else settled it first
  // No appeals left waiting here: the moderators' "needs you" updates are handled.
  const { count: stillPending } = await adminClient().from("moderation_events").select("*", { count: "exact", head: true }).eq("community_id", event.community_id).eq("appeal_status", "pending");
  if (!stillPending) {
    await adminClient().from("notices").update({ resolved_at: new Date().toISOString() }).eq("kind", "appeal").eq("ref_id", event.community_id).is("resolved_at", null);
  }
  if (accept) await restore(event);
  else if (event.message_id) {
    const { data: msg } = await adminClient().from("messages").select("metadata").eq("id", event.message_id).single();
    await adminClient().from("messages").update({ metadata: { ...((msg?.metadata ?? {}) as object), appeal: "rejected" } }).eq("id", event.message_id);
  }
  if (event.user_id) {
    await notify(
      [event.user_id],
      "communities",
      accept
        ? `✅ Your appeal was accepted${by ? "" : " automatically"}: your message is now in the chat.`
        : `Your appeal wasn't accepted${by ? " by a moderator" : ""}. Please check the community's rules.`,
      `/communities/${event.community_id}`,
    );
  }
}

/** A moderator's answer (also used for one-tap "undo" on the autopilot list: undo = accept). */
export async function resolveAppeal(eventId: string, moderatorId: string, accept: boolean): Promise<Result> {
  const event = await loadEvent(eventId);
  if (!event || !isModerator((await communityMembership(event.community_id, moderatorId))?.role)) return { ok: false, error: "Not found." };
  if (!event.appeal_status) {
    // Undo without an appeal: treat it as one, accepted.
    await adminClient().from("moderation_events").update({ appeal_status: "pending", appealed_at: new Date().toISOString() }).eq("id", event.id).is("appeal_status", null);
  }
  await settle({ ...event, appeal_status: "pending" }, accept, moderatorId);
  return { ok: true };
}

/** A good history there: in the community a week, a few messages, nothing else refused or hidden in a month. */
export async function goodHistory(communityId: string, userId: string, exceptEventId: string): Promise<boolean> {
  const db = adminClient();
  const { data: member } = await db.from("community_members").select("joined_at").eq("community_id", communityId).eq("user_id", userId).maybeSingle();
  if (!member || Date.now() - Date.parse(member.joined_at) < GOOD_HISTORY.days * 86_400_000) return false;
  const { data: channels } = await db.from("conversations").select("id").eq("community_id", communityId);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [{ count: messages }, { count: others }] = await Promise.all([
    db.from("messages").select("*", { count: "exact", head: true }).in("conversation_id", (channels ?? []).map((c) => c.id)).eq("sender_user_id", userId).is("removed_at", null),
    db
      .from("moderation_events")
      .select("*", { count: "exact", head: true })
      .eq("community_id", communityId)
      .eq("user_id", userId)
      .in("action", ["refused", "hidden_after_reports"])
      .gt("created_at", monthAgo)
      .neq("id", exceptEventId),
  ]);
  return (messages ?? 0) >= GOOD_HISTORY.messages && (others ?? 0) === 0;
}

/** Appeals nobody answered within 3 days: accepted for a good history, rejected otherwise. Never waits forever. */
export async function autoResolveAppeals(only?: string[]): Promise<number> {
  const cutoff = new Date(Date.now() - APPEAL_WAIT_HOURS * 3_600_000).toISOString();
  let query = adminClient()
    .from("moderation_events")
    .select("id, community_id, conversation_id, message_id, user_id, action, original_text, appeal_status")
    .eq("appeal_status", "pending")
    .lt("appealed_at", cutoff);
  if (only) query = query.in("community_id", only); // tests: only their own communities
  const { data: due } = await query.limit(100);
  for (const event of due ?? []) {
    const good = event.user_id ? await goodHistory(event.community_id, event.user_id, event.id) : false;
    await settle(event, good, null);
  }
  return due?.length ?? 0;
}
