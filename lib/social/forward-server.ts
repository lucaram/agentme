import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createConversation, findConversation, postMessage } from "@/lib/data/chat";
import { getContactRow, type AgentRow } from "@/lib/data/agents";
import { DM_CLOSED, dmState } from "@/lib/people/dm";
import { canPost, type ConvRow } from "./shared";
import { guardCommunityPost } from "./guard-server";
import { autopilot } from "./moderation-server";
import { canForward, forwardText, nextForward, placesAllowed } from "./forward";

/**
 * ↪ Forward, on the server: where you can forward to (your contacts, groups you
 * can post in, communities you're in and not muted), and posting the labelled
 * copy in each place through that place's usual checks.
 */

export type ForwardPlace = { key: string; kind: "contact" | "group" | "community"; name: string; detail: string; avatar: string };

export async function forwardPlacesFor(userId: string, agent: AgentRow): Promise<ForwardPlace[]> {
  const db = adminClient();
  const [{ data: contactRows }, { data: memberships }, { data: communityRows }] = await Promise.all([
    db.from("contacts").select("requester_agent, addressee_agent").eq("status", "accepted").or(`requester_agent.eq.${agent.id},addressee_agent.eq.${agent.id}`),
    db.from("conversation_members").select("role, conversations!inner(id, kind, title, only_admins_send)").eq("user_id", userId).eq("conversations.kind", "group"),
    db.from("community_members").select("muted_until, communities!inner(id, name, avatar)").eq("user_id", userId),
  ]);
  const otherIds = (contactRows ?? []).map((c) => (c.requester_agent === agent.id ? c.addressee_agent : c.requester_agent));
  const { data: people } = otherIds.length
    ? await db.from("agents").select("id, handle, display_name, avatar, type, guest").in("id", otherIds)
    : { data: [] as { id: string; handle: string; display_name: string; avatar: string; type: string; guest: boolean }[] };
  const contacts: ForwardPlace[] = (people ?? [])
    .filter((p) => p.type === "personal" && !p.guest)
    .sort((a, b) => a.display_name.localeCompare(b.display_name))
    .map((p) => ({ key: `contact:${p.id}`, kind: "contact", name: p.display_name, detail: `@${p.handle} · direct chat`, avatar: p.avatar }));

  const groups: ForwardPlace[] = (memberships ?? []).flatMap((m): ForwardPlace[] => {
    const c = m.conversations as unknown as { id: string; title: string | null; only_admins_send: boolean };
    if (c.only_admins_send && m.role !== "owner" && m.role !== "admin") return [];
    return [{ key: `chat:${c.id}`, kind: "group", name: c.title ?? "Group", detail: "group", avatar: "👥" }];
  });

  const now = Date.now();
  const communities = (communityRows ?? [])
    .filter((m) => !m.muted_until || Date.parse(m.muted_until) <= now)
    .map((m) => m.communities as unknown as { id: string; name: string; avatar: string });
  const { data: generals } = communities.length
    ? await db.from("conversations").select("id, community_id").eq("kind", "channel").eq("channel", "general").in("community_id", communities.map((c) => c.id))
    : { data: [] as { id: string; community_id: string | null }[] };
  const communityPlaces: ForwardPlace[] = communities.flatMap((c): ForwardPlace[] => {
    const general = (generals ?? []).find((g) => g.community_id === c.id);
    return general ? [{ key: `chat:${general.id}`, kind: "community", name: c.name, detail: "community · General", avatar: c.avatar }] : [];
  });
  return [...contacts, ...groups.sort((a, b) => a.name.localeCompare(b.name)), ...communityPlaces.sort((a, b) => a.name.localeCompare(b.name))];
}

export type ForwardResult = { key: string; name: string; ok: boolean; error?: string; conversationId?: string };

/** A message you can see (RLS), checked for forwarding: what to send and how many chats at once. */
export async function forwardable(userId: string, messageId: string) {
  const supabase = await createClient();
  const { data: original } = await supabase
    .from("messages")
    .select("id, content, is_ai_generated, removed_at, metadata, sender_agent_id, sender_user_id, visible_to")
    .eq("id", messageId)
    .maybeSingle();
  if (!original || (original.visible_to && original.visible_to !== userId)) return { ok: false as const, error: "Not found." };
  const sender = original.sender_agent_id ? (await adminClient().from("agents").select("handle").eq("id", original.sender_agent_id).maybeSingle()).data : null;
  const message = { ...original, senderHandle: sender?.handle ?? null, system: !original.sender_agent_id && !original.sender_user_id };
  const allowed = canForward(message);
  if (!allowed.ok) return { ok: false as const, error: allowed.error };
  return { ok: true as const, message, limit: placesAllowed(message) };
}

/** Forwards a message you can see to up to 5 places (1 if it was forwarded many times). */
export async function forwardMessage(userId: string, agent: AgentRow, messageId: string, keys: string[]): Promise<{ error: string } | { results: ForwardResult[] }> {
  const check = await forwardable(userId, messageId);
  if (!check.ok) return { error: check.error };
  const { message, limit } = check;
  const wanted = [...new Set(keys)];
  if (!wanted.length) return { error: "Choose where to forward it." };
  if (wanted.length > limit) return { error: limit === 1 ? "This was forwarded many times: you can forward it to one chat at a time." : `You can forward to up to ${limit} chats at once.` };

  const forwarded = nextForward(message);
  const text = forwardText(message).slice(0, 8000);
  const places = new Map((await forwardPlacesFor(userId, agent)).map((p) => [p.key, p]));
  const results: ForwardResult[] = [];
  for (const key of wanted) {
    const place = places.get(key);
    if (!place) {
      results.push({ key, name: "That chat", ok: false, error: "You can't post there." });
      continue;
    }
    const sent = await postForward(userId, agent, place, text, forwarded);
    results.push({ key, name: place.name, ...sent });
  }
  return { results };
}

async function postForward(
  userId: string,
  agent: AgentRow,
  place: ForwardPlace,
  text: string,
  forwarded: { count: number; from_ai: string | null },
): Promise<{ ok: boolean; error?: string; conversationId?: string }> {
  const db = adminClient();
  let conversationId: string;
  let flags: string[] = [];
  if (place.kind === "contact") {
    const otherId = place.key.slice("contact:".length);
    const { data: other } = await db.from("agents").select("id, owner_id").eq("id", otherId).maybeSingle();
    if (!other || (await getContactRow(agent.id, other.id))?.status !== "accepted") return { ok: false, error: DM_CLOSED.removed };
    const conv = (await findConversation("dm", [userId, other.owner_id])) ?? (await createConversation({ kind: "dm", createdBy: userId, memberIds: [other.owner_id] }));
    const { state } = await dmState(conv.id, userId, agent.id);
    if (state !== "open") return { ok: false, error: DM_CLOSED[state] };
    conversationId = conv.id;
  } else {
    conversationId = place.key.slice("chat:".length);
    const { data: conv } = await db.from("conversations").select("*").eq("id", conversationId).maybeSingle();
    if (!conv) return { ok: false, error: "That chat no longer exists." };
    const allowed = await canPost(conv as unknown as ConvRow, userId);
    if (!allowed.ok) return { ok: false, error: allowed.error };
    // Communities: the same checks as any post (slow mode, links, repeats, then the autopilot).
    if (conv.kind === "channel" && conv.community_id) {
      const guard = await guardCommunityPost(conv.community_id, userId, text);
      if (!guard.ok) return { ok: false, error: guard.error };
      const auto = await autopilot({ communityId: conv.community_id, conversationId, userId, text, level: guard.level, confirmed: false });
      if (auto.action === "refuse") return { ok: false, error: auto.message };
      if (auto.action === "nudge") return { ok: false, error: `${auto.message} Open the community to post it yourself if you still want to.` };
      flags = [...new Set([...guard.flags, ...auto.flags])];
    }
  }
  await postMessage({ conversationId, from: "human", userId, content: text, metadata: { forwarded, ...(flags.length ? { flags } : {}) } });
  return { ok: true, conversationId };
}
