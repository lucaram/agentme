/**
 * Groups and communities: roles, permissions, posting rules, joining, invites,
 * moderation and what the browser may read. Throwaway users, deleted afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, SUPABASE_URL, admin, dbUp } from "./env";

type AgentRow = NonNullable<Awaited<ReturnType<typeof import("@/lib/data/agents").getAgentById>>>;
type P = { userId: string; email: string; agent: AgentRow; me: { userId: string; agent: AgentRow } };
const run = Math.random().toString(36).slice(2, 7);
const people: Record<"a" | "b" | "c" | "d", P> = {} as never;
const PASSWORD = "social-test-password";
const communityIds: string[] = [];

const lib = async () => ({
  groups: await import("@/lib/social/groups"),
  communities: await import("@/lib/social/communities"),
  shared: await import("@/lib/social/shared"),
  chat: await import("@/lib/data/chat"),
});
const role = async (conv: string, p: P) =>
  (await admin().from("conversation_members").select("role").eq("conversation_id", conv).eq("user_id", p.userId).maybeSingle()).data?.role ?? null;
const conv = async (id: string) => (await admin().from("conversations").select("*").eq("id", id).single()).data!;

describe.skipIf(!dbUp)("groups and communities (live)", () => {
  beforeAll(async () => {
    const db = admin();
    for (const key of ["a", "b", "c", "d"] as const) {
      const handle = `ts${run}_${key}`;
      const email = `${handle}@social.test`;
      const { data: created, error } = await db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      if (error) throw error;
      const { data: agent } = await db.from("agents").insert({ owner_id: created.user.id, handle, display_name: `Test ${key.toUpperCase()}`, avatar: "🦊" }).select("*").single();
      people[key] = { userId: created.user.id, email, agent: agent!, me: { userId: created.user.id, agent: agent! } };
    }
    // a knows everyone; c only accepts group invites.
    for (const k of ["b", "c", "d"] as const) await db.from("contacts").insert({ requester_agent: people.a.agent.id, addressee_agent: people[k].agent.id, status: "accepted" });
    await db.from("agents").update({ group_add_policy: "nobody" }).eq("id", people.c.agent.id);
    people.c.agent.group_add_policy = "nobody";
  });

  afterAll(async () => {
    const db = admin();
    if (communityIds.length) await db.from("communities").delete().in("id", communityIds);
    const ids = Object.values(people).map((p) => p.userId);
    await db.from("conversations").delete().in("created_by", ids);
    for (const id of ids) await db.auth.admin.deleteUser(id);
  });

  it("groups: owner and admins manage, members don't; invites respect 'who can add me'", async () => {
    const { groups, shared } = await lib();
    const { a, b, c, d } = people;
    const made = await groups.createGroup(a.me, { title: "Five-a-side", description: "Thursdays", avatar: "⚽", memberAgentIds: [b.agent.id, c.agent.id] });
    expect(made).toMatchObject({ ok: true, invited: 1 });
    const id = (made as { id: string }).id;
    expect(await role(id, a)).toBe("owner");
    expect(await role(id, b)).toBe("member");
    expect(await role(id, c)).toBeNull(); // invited instead
    const { data: invite } = await admin().from("inbox_items").select("id").eq("owner_id", c.userId).eq("kind", "group_invite").single();
    expect(await groups.answerGroupInvite(invite!.id, c.me, true)).toEqual({ ok: true, id });
    expect(await role(id, c)).toBe("member");

    // Members can't manage.
    expect((await groups.addMembers(id, b.me, [d.agent.id])).ok).toBe(false);
    expect((await groups.removeMember(id, b.me, c.userId)).ok).toBe(false);
    expect((await groups.updateGroupSettings(id, b.me, { only_admins_send: true, only_admins_edit: true, approve_new_members: true })).ok).toBe(false);
    expect(await groups.updateGroupInfo(id, b.me, { title: "Hacked", description: "", avatar: "⚽" })).toEqual({ ok: false, error: "Only admins can edit this group's info." });

    // Only admins send.
    await groups.updateGroupSettings(id, a.me, { only_admins_send: true, only_admins_edit: true, approve_new_members: true });
    expect((await shared.canPost(await conv(id), b.userId)).ok).toBe(false);
    expect((await shared.canPost(await conv(id), a.userId)).ok).toBe(true);
    expect(await groups.setMemberRole(id, a.me, b.userId, "admin")).toEqual({ ok: true });
    expect((await shared.canPost(await conv(id), b.userId)).ok).toBe(true);
    // An admin can remove members but never the owner.
    expect(await groups.removeMember(id, b.me, a.userId)).toEqual({ ok: false, error: "The group's owner can't be removed." });
    expect(await groups.removeMember(id, b.me, c.userId)).toEqual({ ok: true });

    // Invite link with approval.
    const url = await shared.createJoinLink({ conversationId: id }, a.userId);
    const token = url.split("/invite/")[1];
    expect(await groups.joinGroupWithLink(token, d.me)).toEqual({ ok: true, status: "requested", id });
    const { data: req } = await admin().from("join_requests").select("id").eq("conversation_id", id).eq("user_id", d.userId).single();
    expect((await groups.decideGroupRequest(req!.id, c.me, true)).ok).toBe(false); // not even a member
    expect(await groups.decideGroupRequest(req!.id, a.me, true)).toEqual({ ok: true });
    expect(await role(id, d)).toBe("member");

    // Blocking: d leaves and can't be added back.
    expect(await groups.blockGroup(id, d.me)).toEqual({ ok: true });
    expect(await groups.addMembers(id, a.me, [d.agent.id])).toMatchObject({ ok: true, added: 0, skipped: 1 });

    // Reports and removal.
    const msg = await (await lib()).chat.postMessage({ conversationId: id, from: "human", userId: a.userId, content: "buy cheap watches" });
    expect(await shared.reportMessage(msg.id, b.userId, "spam")).toEqual({ ok: true });
    expect((await shared.removeMessage(msg.id, c.userId)).ok).toBe(false); // c was removed
    expect(await shared.removeMessage(msg.id, b.userId)).toEqual({ ok: true }); // admin
    const { data: removed } = await admin().from("messages").select("content, removed_at").eq("id", msg.id).single();
    expect(removed!.content).toContain("removed by a moderator");
    expect((await admin().from("reports").select("status").eq("message_id", msg.id).single()).data!.status).toBe("resolved");

    // Only the owner deletes; when the owner leaves, an admin takes over.
    expect((await groups.deleteGroup(id, b.me)).ok).toBe(false);
    await admin().from("conversation_members").delete().eq("conversation_id", id).eq("user_id", a.userId);
    await groups.handOverIfOwnerLeft(id, a.userId, true);
    expect(await role(id, b)).toBe("owner");
  });

  it("communities: rules, Announcements vs General, mutes, private requests, bans", async () => {
    const { communities, shared } = await lib();
    const { a, b, c, d } = people;
    const made = await communities.createCommunity(a.me, { name: `Test FC ${run}`, description: "Fans", rules: "Be kind.", avatar: "⚽", visibility: "public" });
    expect(made.ok).toBe(true);
    const id = (made as { id: string }).id;
    communityIds.push(id);
    const { data: chans } = await admin().from("conversations").select("*").eq("community_id", id);
    const announcements = chans!.find((ch) => ch.channel === "announcements")!;
    const general = chans!.find((ch) => ch.channel === "general")!;
    expect(chans).toHaveLength(2);

    expect(await communities.joinCommunity(id, b.me, { acceptRules: false })).toEqual({ ok: false, error: "Please accept the community rules to join." });
    expect(await communities.joinCommunity(id, b.me, { acceptRules: true })).toEqual({ ok: true, status: "joined" });
    expect(await role(general.id, b)).not.toBeNull(); // in both chats

    expect((await shared.canPost(announcements, b.userId)).ok).toBe(false);
    expect((await shared.canPost(general, b.userId)).ok).toBe(true);
    expect((await shared.canPost(announcements, a.userId)).ok).toBe(true);

    // Moderators mute members; members can't moderate.
    expect((await communities.muteInCommunity(id, b.me, a.userId, 24)).ok).toBe(false);
    expect(await communities.muteInCommunity(id, a.me, b.userId, 24)).toEqual({ ok: true });
    expect((await shared.canPost(general, b.userId)).ok).toBe(false);
    await communities.muteInCommunity(id, a.me, b.userId, 0);

    // A moderator can't remove the owner or another moderator; the owner can.
    await communities.joinCommunity(id, c.me, { acceptRules: true });
    await communities.setCommunityRole(id, a.me, c.userId, "moderator");
    expect((await communities.removeFromCommunity(id, c.me, a.userId, false, "")).ok).toBe(false);
    await communities.setCommunityRole(id, a.me, b.userId, "moderator");
    expect((await communities.removeFromCommunity(id, c.me, b.userId, false, "")).ok).toBe(false);
    await communities.setCommunityRole(id, a.me, b.userId, "member");

    // Moderators remove messages in community chats.
    const msg = await (await lib()).chat.postMessage({ conversationId: general.id, from: "human", userId: b.userId, content: "rude words" });
    expect(await shared.removeMessage(msg.id, c.userId)).toEqual({ ok: true });

    // Ban: removed and can't come back.
    expect(await communities.removeFromCommunity(id, c.me, b.userId, true, "abuse")).toEqual({ ok: true });
    expect(await role(general.id, b)).toBeNull();
    expect(await communities.joinCommunity(id, b.me, { acceptRules: true })).toEqual({ ok: false, error: "You can't join this community." });

    // The owner can't just leave.
    expect((await communities.leaveCommunity(id, a.me)).ok).toBe(false);

    // Private: request, then a moderator approves; an invite link skips the queue.
    await communities.updateCommunity(id, a.me, { name: `Test FC ${run}`, description: "Fans", rules: "Be kind.", avatar: "⚽", visibility: "private" });
    expect(await communities.joinCommunity(id, d.me, { acceptRules: true })).toEqual({ ok: true, status: "requested" });
    const { data: req } = await admin().from("join_requests").select("id").eq("community_id", id).eq("user_id", d.userId).single();
    expect(await communities.decideCommunityRequest(req!.id, c.me, true)).toEqual({ ok: true });
    expect(await role(general.id, d)).not.toBeNull();
  });

  it("tab badges count what's waiting for you; removals and decisions arrive as updates", async () => {
    const { groups, shared } = await lib();
    const { a, b, d } = people;
    const signedIn = async (p: P) => {
      const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
      await client.auth.signInWithPassword({ email: p.email, password: PASSWORD });
      return client;
    };
    const counts = async (p: P) => {
      const { data } = await (await signedIn(p)).rpc("action_counts");
      return { contacts: Number(data![0].contacts), groups: Number(data![0].groups), communities: Number(data![0].communities) };
    };
    const made = await groups.createGroup(a.me, { title: "Badges", description: "", avatar: "👥", memberAgentIds: [b.agent.id] });
    const id = (made as { id: string }).id;
    await admin().from("notices").delete().in("user_id", [a.userId, b.userId, d.userId]);
    const before = await counts(a);

    // An admin sees join requests to review.
    const url = await shared.createJoinLink({ conversationId: id }, a.userId);
    await groups.joinGroupWithLink(url.split("/invite/")[1], d.me);
    expect((await counts(a)).groups).toBe(before.groups + 1);
    expect((await counts(b)).groups).toBe(0); // plain members don't
    const { data: req } = await admin().from("join_requests").select("id").eq("conversation_id", id).eq("user_id", d.userId).single();
    await groups.decideGroupRequest(req!.id, a.me, false);
    expect((await counts(a)).groups).toBe(before.groups);

    // The person hears back, and removals are told too.
    const { data: declined } = await admin().from("notices").select("text").eq("user_id", d.userId);
    expect(declined!.map((n) => n.text)).toEqual(["Your request to join “Badges” was declined."]);
    await groups.removeMember(id, a.me, b.userId);
    const { data: removed } = await admin().from("notices").select("text, area").eq("user_id", b.userId);
    expect(removed).toEqual([{ text: "🚪 Test A removed you from “Badges”.", area: "groups" }]);
    expect((await counts(b)).groups).toBe(1);
    await (await signedIn(b)).rpc("mark_notices_seen", { p_area: "groups" });
    expect((await counts(b)).groups).toBe(0);

    // Contacts: incoming contact requests.
    await admin().from("contacts").insert({ requester_agent: b.agent.id, addressee_agent: d.agent.id });
    expect((await counts(d)).contacts).toBe(1);

    // My Agent keeps its counter while a request waits for an answer, even once read.
    const { chat } = await lib();
    const myAgent = await chat.getOrCreateMyAgentConversation(d.userId);
    const myAgentCount = async () => {
      const { data } = await (await signedIn(d)).rpc("unread_counts");
      return Number(data?.find((r) => r.conversation_id === myAgent.id)?.unread ?? 0);
    };
    const { data: item } = await admin()
      .from("inbox_items")
      .insert({ owner_id: d.userId, agent_id: d.agent.id, kind: "question", payload: { kind: "question", question: "Free on Sunday?" } })
      .select("id")
      .single();
    await (await signedIn(d)).rpc("mark_conversation_read", { p_conversation: myAgent.id });
    expect(await myAgentCount()).toBe(1);
    await admin().from("inbox_items").update({ status: "answered" }).eq("id", item!.id);
    expect(await myAgentCount()).toBe(0);
  });

  it("the browser sees private communities and moderation data only when allowed", async () => {
    const { communities } = await lib();
    const { a, b, d } = people;
    const made = await communities.createCommunity(a.me, { name: `Secret ${run}`, description: "", rules: "", avatar: "🗳️", visibility: "private" });
    const id = (made as { id: string }).id;
    communityIds.push(id);
    const asUser = async (p: P) => {
      const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
      await client.auth.signInWithPassword({ email: p.email, password: PASSWORD });
      return client;
    };
    const outsider = await asUser(d);
    expect((await outsider.from("communities").select("id").eq("id", id)).data).toEqual([]);
    expect((await outsider.from("community_members").select("user_id").eq("community_id", id)).data).toEqual([]);
    const owner = await asUser(a);
    expect((await owner.from("communities").select("id").eq("id", id)).data).toHaveLength(1);
    // Writes are server-only.
    expect((await outsider.from("community_members").insert({ community_id: id, user_id: d.userId })).error).not.toBeNull();
    expect((await outsider.from("join_links").select("*")).data).toEqual([]);
    // Reports: moderators only.
    const member = await asUser(b);
    expect((await member.from("reports").select("id").eq("community_id", id)).data).toEqual([]);
  });
});
