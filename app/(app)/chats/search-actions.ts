"use server";

import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { searchBusinesses } from "@/lib/social/businesses";

/** One result: a page to open, or a contact to start a chat with. */
export type SearchHit = { key: string; name: string; icon: string; detail: string; href?: string; openDmWith?: string };
export type SearchSection = { title: string; hits: SearchHit[] };
export type SearchScope = "chats" | "contacts" | "groups" | "communities";

const LIMIT = 8;
const members = (n: number) => `${n.toLocaleString("en-GB")} ${n === 1 ? "member" : "members"}`;

/**
 * The header search, scoped to the tab you're on. Everything is read with the
 * user's own session, so RLS limits it to what they can already see (private
 * communities you're not in never appear; member lists stay private).
 */
export async function searchAction(scope: SearchScope, raw: string): Promise<SearchSection[]> {
  const { user, agent } = await requireAgent();
  const q = String(raw ?? "").trim().replace(/^@/, "").toLowerCase().slice(0, 60);
  if (!q) return [];
  const supabase = await createClient();
  const has = (...texts: (string | null | undefined)[]) => texts.some((t) => t?.toLowerCase().includes(q));

  // ---------------- communities: yours first, then public ones to join
  if (scope === "communities") {
    const [{ data: memberships }, { data: visible }] = await Promise.all([
      supabase.from("community_members").select("community_id").eq("user_id", user.id),
      supabase.from("communities").select("id, name, description, avatar, visibility"),
    ]);
    const mine = new Set((memberships ?? []).map((m) => m.community_id));
    const matches = (visible ?? []).filter((c) => has(c.name, c.description));
    const { data: counts } = matches.length ? await supabase.rpc("community_member_counts", { p_ids: matches.map((c) => c.id) }) : { data: [] };
    const size = new Map((counts ?? []).map((r) => [r.community_id, Number(r.members)]));
    const hit = (c: (typeof matches)[number], label: string): SearchHit => ({
      key: c.id,
      name: c.name,
      icon: c.avatar,
      detail: `${label} · ${members(size.get(c.id) ?? 0)}`,
      href: `/communities/${c.id}`,
    });
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    return [
      { title: "Your communities", hits: matches.filter((c) => mine.has(c.id)).sort(byName).slice(0, LIMIT).map((c) => hit(c, "Member")) },
      {
        title: "Public communities",
        hits: matches
          .filter((c) => !mine.has(c.id) && c.visibility === "public")
          .sort((a, b) => (size.get(b.id) ?? 0) - (size.get(a.id) ?? 0))
          .slice(0, LIMIT)
          .map((c) => hit(c, "Public")),
      },
    ].filter((s) => s.hits.length);
  }

  const [{ data: conversations }, { data: agents }, { data: contacts }, { data: communities }] = await Promise.all([
    supabase.from("conversations").select("id, kind, title, description, avatar, target_agent, community_id, conversation_members(user_id)"),
    supabase.from("agents").select("id, owner_id, handle, display_name, avatar, type"),
    supabase.from("contacts").select("requester_agent, addressee_agent").eq("status", "accepted"),
    scope === "chats" ? supabase.from("communities").select("id, name, avatar") : Promise.resolve({ data: [] as { id: string; name: string; avatar: string }[] }),
  ]);
  const byOwner = new Map((agents ?? []).map((a) => [a.owner_id, a]));
  const byId = new Map((agents ?? []).map((a) => [a.id, a]));
  const communityById = new Map((communities ?? []).map((c) => [c.id, c]));
  const othersIn = (c: { conversation_members: { user_id: string }[] }) =>
    c.conversation_members.filter((m) => m.user_id !== user.id).map((m) => byOwner.get(m.user_id)).filter((a) => a !== undefined);
  const dmWith = new Map<string, string>();
  for (const c of conversations ?? []) {
    const others = othersIn(c);
    if (c.kind === "dm" && others.length === 1) dmWith.set(others[0].id, c.id);
  }
  const contactHits = (skipWithChat: Set<string>) =>
    (contacts ?? [])
      .map((row) => byId.get(row.requester_agent === agent.id ? row.addressee_agent : row.requester_agent))
      .filter((o) => o !== undefined && has(o.display_name, o.handle) && !skipWithChat.has(o.id))
      .map((o) => o!)
      .sort((a, b) => a.display_name.localeCompare(b.display_name))
      .slice(0, LIMIT)
      .map<SearchHit>((o) => {
        // A business opens its page (booking buttons, "Ask us anything"); a person opens your chat.
        if (o.type === "business") return { key: o.id, name: o.display_name, icon: o.avatar, detail: `@${o.handle} · Business`, href: `/u/${o.handle}` };
        const chatId = dmWith.get(o.id);
        return { key: o.id, name: o.display_name, icon: o.avatar, detail: `@${o.handle}`, ...(chatId ? { href: `/chats/${chatId}` } : { openDmWith: o.id }) };
      });

  // Any business that answers anyone (not only ones you know): tap to open its page.
  // People never appear here: finding people stays mutual and private.
  const businessSection = async (alreadyListed: string[]): Promise<SearchSection> => ({
    title: "Businesses",
    hits: (await searchBusinesses(q, alreadyListed)).map((b) => ({
      key: `business-${b.id}`,
      name: b.display_name,
      icon: b.avatar,
      detail: `@${b.handle}${b.bio ? ` · ${b.bio}` : ""} · Page ›`,
      href: `/u/${b.handle}`,
    })),
  });

  // ---------------- contacts
  if (scope === "contacts") {
    const contactsFound = contactHits(new Set());
    return [{ title: "Contacts", hits: contactsFound }, await businessSection(contactsFound.map((h) => h.key))].filter((s) => s.hits.length);
  }

  // ---------------- groups: by name, description or a member's name/@handle
  if (scope === "groups") {
    const hits = (conversations ?? [])
      .filter((c) => c.kind === "group")
      .filter((c) => {
        const others = othersIn(c);
        return has(c.title, c.description, ...others.map((o) => o.display_name), ...others.map((o) => o.handle));
      })
      .sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""))
      .slice(0, LIMIT)
      .map<SearchHit>((c) => ({
        key: c.id,
        name: c.title ?? "Group",
        icon: c.avatar ?? "👥",
        detail: `Group · ${members(c.conversation_members.length)}`,
        href: `/chats/${c.id}`,
      }));
    return [{ title: "Your groups", hits }].filter((s) => s.hits.length);
  }

  // ---------------- chats (and contacts you haven't messaged yet)
  const chats: (SearchHit & { order: number })[] = [];
  for (const c of conversations ?? []) {
    const others = othersIn(c);
    if (c.kind === "my_agent") {
      if (has("my agent", agent.handle)) chats.push({ key: c.id, name: "My Agent", icon: agent.avatar, detail: "Your agent", href: `/chats/${c.id}`, order: 2 });
    } else if (c.kind === "agent_chat") {
      const target = c.target_agent ? byId.get(c.target_agent) : undefined;
      if (has(target?.display_name, target?.handle)) {
        chats.push({ key: c.id, name: `${target?.display_name ?? "Agent"} · agent`, icon: target?.avatar ?? "🤖", detail: "Agent chat", href: `/chats/${c.id}`, order: 2 });
      }
    } else if (c.kind === "channel") {
      const community = communityById.get(c.community_id ?? "");
      if (has(community?.name, c.title)) {
        chats.push({ key: c.id, name: `${community?.name ?? "Community"} · ${c.title}`, icon: community?.avatar ?? "🏟️", detail: "Community", href: `/chats/${c.id}`, order: 2 });
      }
    } else if (c.kind === "group") {
      if (has(c.title, ...others.map((o) => o.display_name), ...others.map((o) => o.handle))) {
        chats.push({ key: c.id, name: c.title ?? "Group", icon: c.avatar ?? "👥", detail: `Group · ${others.length + 1} people`, href: `/chats/${c.id}`, order: 1 });
      }
    } else if (has(c.title, ...others.map((o) => o.display_name), ...others.map((o) => o.handle))) {
      chats.push({
        key: c.id,
        name: c.title ?? others.map((o) => o.display_name).join(", "),
        icon: others[0]?.avatar ?? "💬",
        detail: others[0] ? `@${others[0].handle}` : "Direct message",
        href: `/chats/${c.id}`,
        order: 0,
      });
    }
  }
  chats.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const shown = chats.slice(0, LIMIT);
  // Contacts whose chat is already listed above aren't repeated.
  const listedDms = new Set([...dmWith.entries()].filter(([, chatId]) => shown.some((c) => c.key === chatId)).map(([agentId]) => agentId));
  const contactsFound = contactHits(listedDms);
  return [
    { title: "Chats", hits: shown.map((h) => ({ key: h.key, name: h.name, icon: h.icon, detail: h.detail, href: h.href })) },
    { title: "Contacts", hits: contactsFound.map((h) => ({ ...h, detail: `${h.detail} · Contact` })) },
    await businessSection(contactsFound.map((h) => h.key)),
  ].filter((s) => s.hits.length);
}
