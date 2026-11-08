"use server";

import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ChatHit = { kind: "chat"; id: string; name: string; icon: string; detail: string };
export type ContactHit = { kind: "contact"; agentId: string; name: string; icon: string; handle: string; chatId: string | null };

const LIMIT = 8;

/**
 * Search your own chats (groups, direct messages, My Agent, agent chats) and
 * your contacts by name or @handle. Everything is read with the user's
 * session, so RLS limits it to what they can already see.
 */
export async function searchChatsAction(raw: string): Promise<{ chats: ChatHit[]; contacts: ContactHit[] }> {
  const { user, agent } = await requireAgent();
  const q = String(raw ?? "").trim().replace(/^@/, "").toLowerCase().slice(0, 60);
  if (!q) return { chats: [], contacts: [] };
  const supabase = await createClient();
  const [{ data: conversations }, { data: agents }, { data: contacts }] = await Promise.all([
    supabase.from("conversations").select("id, kind, title, target_agent, conversation_members(user_id)"),
    supabase.from("agents").select("id, owner_id, handle, display_name, avatar"),
    supabase.from("contacts").select("requester_agent, addressee_agent").eq("status", "accepted"),
  ]);
  const byOwner = new Map((agents ?? []).map((a) => [a.owner_id, a]));
  const byId = new Map((agents ?? []).map((a) => [a.id, a]));
  const has = (...texts: (string | null | undefined)[]) => texts.some((t) => t?.toLowerCase().includes(q));

  const chats: ChatHit[] = [];
  const dmWith = new Map<string, string>(); // other agent id -> dm id
  for (const c of conversations ?? []) {
    const others = c.conversation_members.filter((m) => m.user_id !== user.id).map((m) => byOwner.get(m.user_id)).filter((a) => a !== undefined);
    if (c.kind === "dm" && others.length === 1) dmWith.set(others[0].id, c.id);
    let hit: ChatHit | null = null;
    if (c.kind === "my_agent") {
      if (has("my agent", agent.handle)) hit = { kind: "chat", id: c.id, name: "My Agent", icon: agent.avatar, detail: "Your agent" };
    } else if (c.kind === "agent_chat") {
      const target = c.target_agent ? byId.get(c.target_agent) : undefined;
      if (has(target?.display_name, target?.handle)) hit = { kind: "chat", id: c.id, name: `${target?.display_name ?? "Agent"} · agent`, icon: target?.avatar ?? "🤖", detail: "Agent chat" };
    } else if (c.kind === "group") {
      if (has(c.title, ...others.map((o) => o.display_name), ...others.map((o) => o.handle))) {
        hit = { kind: "chat", id: c.id, name: c.title ?? "Group", icon: "👥", detail: `Group · ${others.length + 1} people` };
      }
    } else if (has(c.title, ...others.map((o) => o.display_name), ...others.map((o) => o.handle))) {
      hit = { kind: "chat", id: c.id, name: c.title ?? others.map((o) => o.display_name).join(", "), icon: others[0]?.avatar ?? "💬", detail: others[0] ? `@${others[0].handle}` : "Direct message" };
    }
    if (hit) chats.push(hit);
  }
  // Direct messages first, then groups, then the rest; each alphabetically.
  const order = (h: ChatHit) => (h.detail.startsWith("@") ? 0 : h.detail.startsWith("Group") ? 1 : 2);
  chats.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));

  // Contacts you don't have a chat with yet (the ones you do are already above).
  const contactHits: ContactHit[] = [];
  for (const row of contacts ?? []) {
    const other = byId.get(row.requester_agent === agent.id ? row.addressee_agent : row.requester_agent);
    if (!other || !has(other.display_name, other.handle)) continue;
    const chatId = dmWith.get(other.id) ?? null;
    if (chatId && chats.some((c) => c.id === chatId)) continue;
    contactHits.push({ kind: "contact", agentId: other.id, name: other.display_name, icon: other.avatar, handle: other.handle, chatId });
  }
  contactHits.sort((a, b) => a.name.localeCompare(b.name));
  return { chats: chats.slice(0, LIMIT), contacts: contactHits.slice(0, LIMIT) };
}
