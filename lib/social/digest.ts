import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { notify } from "./shared";

/**
 * Moderators get one daily summary of what the community's agent did, instead
 * of an alert per message; and when no moderator has been around for a while,
 * the owner is reminded, then offered trusted, active members to promote.
 */
const DAY = 86_400_000;
export const INACTIVE_DAYS = { remind: 14, suggest: 30 } as const;

/** A member opened the community or one of its chats (written at most hourly). */
export async function touchSeen(communityId: string, userId: string) {
  await adminClient()
    .from("community_members")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .lt("last_seen_at", new Date(Date.now() - 3_600_000).toISOString());
  // The owner came back: the "no moderator around" reminder is handled.
  await adminClient().from("notices").update({ resolved_at: new Date().toISOString() }).eq("user_id", userId).eq("ref_id", communityId).eq("kind", "quiet_moderators").is("resolved_at", null);
}

export type DigestCounts = { refused: number; hidden: number; nudged: number; appeals: number };

/** What the agent did in a community since `since` (and appeals still waiting). */
export async function digestCounts(communityId: string, since: string): Promise<DigestCounts> {
  const db = adminClient();
  const count = async (action: string) =>
    (await db.from("moderation_events").select("*", { count: "exact", head: true }).eq("community_id", communityId).eq("action", action).gt("created_at", since)).count ?? 0;
  const [refused, hidden, nudged, { count: appeals }] = await Promise.all([
    count("refused"),
    count("hidden_after_reports"),
    count("nudged"),
    db.from("moderation_events").select("*", { count: "exact", head: true }).eq("community_id", communityId).eq("appeal_status", "pending"),
  ]);
  return { refused, hidden, nudged, appeals: appeals ?? 0 };
}

/** "Your community's agent kept 4 messages out, hid 1 after reports and nudged 3. 1 appeal needs you (optional)." */
export function digestText(name: string, c: DigestCounts): string | null {
  const parts = [
    c.refused && `kept ${c.refused} ${c.refused === 1 ? "message" : "messages"} out`,
    c.hidden && `hid ${c.hidden} after members' reports`,
    c.nudged && `nudged ${c.nudged} ${c.nudged === 1 ? "member" : "members"} to rethink a message`,
  ].filter(Boolean) as string[];
  if (!parts.length && !c.appeals) return null;
  const did = parts.length ? `🤖 ${name}: your community's agent ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]} in the last day.` : `🤖 ${name}:`;
  const appeals = c.appeals ? ` ${c.appeals} ${c.appeals === 1 ? "appeal needs" : "appeals need"} you (optional).` : "";
  return `${did}${appeals}`.slice(0, 300);
}

/** Once a day per community with something to report: one notice for its owner and moderators. */
export async function sendDigests(only?: string[]): Promise<number> {
  const db = adminClient();
  const dayAgo = new Date(Date.now() - DAY).toISOString();
  let query = db.from("communities").select("id, name").or(`digest_sent_at.is.null,digest_sent_at.lt.${dayAgo}`);
  if (only) query = query.in("id", only); // tests: only their own communities
  const { data: due } = await query.limit(200);
  let sent = 0;
  for (const c of due ?? []) {
    const text = digestText(c.name, await digestCounts(c.id, dayAgo));
    await db.from("communities").update({ digest_sent_at: new Date().toISOString() }).eq("id", c.id);
    if (!text) continue;
    const { data: mods } = await db.from("community_members").select("user_id").eq("community_id", c.id).in("role", ["owner", "moderator"]);
    await notify((mods ?? []).map((m) => m.user_id), "communities", text, `/communities/${c.id}`, { kind: "digest" });
    sent++;
  }
  return sent;
}

/** Members to suggest as moderators: around lately, active, nothing refused or hidden in a month. */
export async function suggestModerators(communityId: string, limit = 3): Promise<{ userId: string; messages: number }[]> {
  const db = adminClient();
  const monthAgo = new Date(Date.now() - 30 * DAY).toISOString();
  const weekAgo = new Date(Date.now() - 7 * DAY).toISOString();
  const [{ data: members }, { data: channels }, { data: flagged }] = await Promise.all([
    db.from("community_members").select("user_id, joined_at").eq("community_id", communityId).eq("role", "member").gt("last_seen_at", weekAgo),
    db.from("conversations").select("id").eq("community_id", communityId),
    db.from("moderation_events").select("user_id").eq("community_id", communityId).in("action", ["refused", "hidden_after_reports"]).gt("created_at", monthAgo),
  ]);
  const excluded = new Set((flagged ?? []).map((f) => f.user_id));
  const candidates = (members ?? []).filter((m) => !excluded.has(m.user_id) && Date.now() - Date.parse(m.joined_at) >= 7 * DAY);
  if (!candidates.length) return [];
  const { data: recent } = await db
    .from("messages")
    .select("sender_user_id")
    .in("conversation_id", (channels ?? []).map((c) => c.id))
    .in("sender_user_id", candidates.map((m) => m.user_id))
    .is("removed_at", null)
    .gt("created_at", monthAgo)
    .limit(5000);
  const counts = new Map<string, number>();
  for (const r of recent ?? []) if (r.sender_user_id) counts.set(r.sender_user_id, (counts.get(r.sender_user_id) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, n]) => n >= 10)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([userId, messages]) => ({ userId, messages }));
}

/** How long since any owner or moderator was around (days). */
export async function daysSinceModeratorSeen(communityId: string): Promise<number> {
  const { data } = await adminClient().from("community_members").select("last_seen_at").eq("community_id", communityId).in("role", ["owner", "moderator"]);
  const latest = Math.max(0, ...(data ?? []).map((m) => Date.parse(m.last_seen_at)));
  return latest ? (Date.now() - latest) / DAY : Infinity;
}

/** No moderator around for 2 weeks: remind the owner; after a month, suggest members to promote. At most every 2 weeks. */
export async function nudgeInactiveModerators(only?: string[]): Promise<number> {
  const db = adminClient();
  const twoWeeksAgo = new Date(Date.now() - INACTIVE_DAYS.remind * DAY).toISOString();
  let query = db.from("communities").select("id, name, owner_id").or(`mods_nudged_at.is.null,mods_nudged_at.lt.${twoWeeksAgo}`);
  if (only) query = query.in("id", only); // tests: only their own communities
  const { data: communities } = await query.limit(200);
  let nudged = 0;
  for (const c of communities ?? []) {
    if (!c.owner_id) continue;
    const days = await daysSinceModeratorSeen(c.id);
    if (days < INACTIVE_DAYS.remind) continue;
    const suggestions = days >= INACTIVE_DAYS.suggest ? await suggestModerators(c.id) : [];
    const text = suggestions.length
      ? `👋 ${c.name} hasn't had a moderator around for a month. ${suggestions.length === 1 ? "An active member could" : `${suggestions.length} active members could`} help: open the community to make them a moderator.`
      : `👋 ${c.name} hasn't had a moderator around for 2 weeks. Its agent keeps it tidy, but appeals wait for you.`;
    await notify([c.owner_id], "communities", text.slice(0, 300), `/communities/${c.id}`, { kind: "quiet_moderators", needsAction: suggestions.length > 0 });
    await db.from("communities").update({ mods_nudged_at: new Date().toISOString() }).eq("id", c.id);
    nudged++;
  }
  return nudged;
}
