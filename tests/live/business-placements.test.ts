/**
 * Businesses in groups and communities: who can add, remove and invite them,
 * what each side can read, and that a business is never a member.
 * Throwaway users, deleted afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, SUPABASE_URL, admin, dbUp } from "./env";

type AgentRow = NonNullable<Awaited<ReturnType<typeof import("@/lib/data/agents").getAgentById>>>;
type P = { userId: string; email: string; agent: AgentRow };
const run = Math.random().toString(36).slice(2, 7);
const PASSWORD = "placement-test-password";
const people = {} as Record<"admin" | "member" | "stranger" | "shop" | "closed", P>;
const communityIds: string[] = [];
let groupId = "";

const lib = async () => ({ businesses: await import("@/lib/social/businesses"), groups: await import("@/lib/social/groups"), communities: await import("@/lib/social/communities") });
const me = (p: P) => ({ userId: p.userId, agent: p.agent });
const signedIn = async (p: P) => {
  const c = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email: p.email, password: PASSWORD });
  if (error) throw error;
  return c;
};

describe.skipIf(!dbUp)("businesses in groups and communities (live)", () => {
  beforeAll(async () => {
    const db = admin();
    for (const key of ["admin", "member", "stranger", "shop", "closed"] as const) {
      const handle = `tp${run}_${key}`.slice(0, 20);
      const email = `${handle}@placement.test`;
      const { data: created, error } = await db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      if (error) throw error;
      const business = key === "shop" || key === "closed";
      const { data: agent } = await db
        .from("agents")
        .insert({
          owner_id: created.user.id,
          handle,
          display_name: `Test ${key}`,
          avatar: business ? "🏪" : "🦊",
          type: business ? "business" : "personal",
          contact_policy: key === "shop" ? "anyone" : "contacts_only",
        })
        .select("*")
        .single();
      people[key] = { userId: created.user.id, email, agent: agent! };
    }
    // The admin knows the member and (as a customer) the shop.
    for (const k of ["member", "shop"] as const) await db.from("contacts").insert({ requester_agent: people.admin.agent.id, addressee_agent: people[k].agent.id, status: "accepted" });
  });

  afterAll(async () => {
    const db = admin();
    if (communityIds.length) await db.from("communities").delete().in("id", communityIds);
    const ids = Object.values(people).map((p) => p.userId);
    await db.from("conversations").delete().in("created_by", ids);
    for (const id of ids) await db.auth.admin.deleteUser(id);
  });

  it("finds @mentions, ignoring @agent and e-mail addresses", async () => {
    const { businesses } = await lib();
    expect(businesses.mentionedHandles("@Trattoria do you have a table? cc @marco, mail me at a@b.example. @agent summarise")).toEqual(["trattoria", "marco"]);
  });

  it("search finds businesses that answer anyone, by name or @address", async () => {
    const { businesses } = await lib();
    const handles = async (q: string, exclude: string[] = []) => (await businesses.searchBusinesses(q, exclude)).map((b) => b.handle);
    expect(await handles(`tp${run}_sh`)).toEqual([people.shop.agent.handle]);
    expect(await handles(`@tp${run}`)).toEqual([people.shop.agent.handle]); // not the people, not the closed business
    expect(await handles("Test shop")).toContain(people.shop.agent.handle);
    expect(await handles(`tp${run}_shop`, [people.shop.agent.id])).toEqual([]);
    // Filter syntax in the text is ignored, never interpreted.
    expect(await handles(`tp${run}_shop),type.eq.personal,handle.ilike.%`)).toEqual([]);
    expect(await handles("x")).toEqual([]);
  });

  it("groups: admins add a business (never as a member), anyone can remove it", async () => {
    const { businesses, groups } = await lib();
    const made = await groups.createGroup(me(people.admin), { title: "Dinner club", description: "", avatar: "🍕", memberAgentIds: [people.member.agent.id, people.shop.agent.id] });
    expect(made.ok).toBe(true);
    groupId = (made as { id: string }).id;
    // The shop (a contact) was skipped as a member.
    const { data: members } = await admin().from("conversation_members").select("user_id").eq("conversation_id", groupId);
    expect(members?.map((m) => m.user_id).sort()).toEqual([people.admin.userId, people.member.userId].sort());

    expect(await businesses.addBusinessToGroup(groupId, me(people.member), people.shop.agent.handle)).toMatchObject({ ok: false, error: expect.stringContaining("Only admins") });
    expect(await businesses.addBusinessToGroup(groupId, me(people.admin), people.closed.agent.handle)).toMatchObject({ ok: false, error: expect.stringContaining("own customers") });
    expect(await businesses.addBusinessToGroup(groupId, me(people.admin), people.member.agent.handle)).toMatchObject({ ok: false, error: expect.stringContaining("No business") });
    expect(await businesses.addBusinessToGroup(groupId, me(people.admin), `@${people.shop.agent.handle}`)).toEqual({ ok: true });
    expect(await businesses.addBusinessToGroup(groupId, me(people.admin), people.shop.agent.handle)).toMatchObject({ ok: false, error: expect.stringContaining("already") });

    // The business was told, in its own My Agent chat.
    const { data: note } = await admin().from("messages").select("content").eq("sender_agent_id", people.shop.agent.id).ilike("content", "%Dinner club%");
    expect(note).toHaveLength(1);
  });

  it("the business sees where it is, but not the group's messages", async () => {
    const shop = await signedIn(people.shop);
    const { data: mine } = await shop.from("business_placements").select("conversation_id");
    expect(mine).toEqual([{ conversation_id: groupId }]);
    const { data: convs } = await shop.from("conversations").select("id").eq("id", groupId);
    expect(convs).toEqual([]);
    const { data: msgs } = await shop.from("messages").select("id").eq("conversation_id", groupId);
    expect(msgs).toEqual([]);
    // Members see the group's businesses; strangers don't.
    const member = await signedIn(people.member);
    expect((await member.from("business_placements").select("id").eq("conversation_id", groupId)).data).toHaveLength(1);
    const stranger = await signedIn(people.stranger);
    expect((await stranger.from("business_placements").select("id").eq("conversation_id", groupId)).data).toEqual([]);
    // Nobody writes placements from the browser.
    const { error } = await member.from("business_placements").insert({ business_agent_id: people.shop.agent.id, conversation_id: groupId });
    expect(error).not.toBeNull();
  });

  it("a member (not only admins) can remove the business", async () => {
    const { businesses } = await lib();
    expect(await businesses.removeBusinessFromGroup(groupId, me(people.stranger), people.shop.agent.id)).toMatchObject({ ok: false });
    expect(await businesses.removeBusinessFromGroup(groupId, me(people.member), people.shop.agent.id)).toEqual({ ok: true });
    const { count } = await admin().from("business_placements").select("*", { count: "exact", head: true }).eq("conversation_id", groupId);
    expect(count).toBe(0);
  });

  it("businesses can't join groups or communities as members", async () => {
    const { communities } = await lib();
    const made = await communities.createCommunity(me(people.admin), { name: `Neighbours ${run}`, description: "A test community about football and match days", avatar: "🏟️", visibility: "public" });
    expect(made.ok).toBe(true);
    communityIds.push((made as { id: string }).id);
    expect(await communities.joinCommunity(communityIds[0], me(people.shop), { acceptRules: true })).toMatchObject({ ok: false, error: expect.stringContaining("official partner") });
  });

  it("communities: moderators invite an official partner; it's listed once the business accepts", async () => {
    const { businesses } = await lib();
    const id = communityIds[0];
    expect(await businesses.invitePartner(id, me(people.stranger), people.shop.agent.handle)).toMatchObject({ ok: false });
    expect(await businesses.invitePartner(id, me(people.admin), people.shop.agent.handle)).toEqual({ ok: true });
    const stranger = await signedIn(people.stranger);
    // Invitations are for moderators (and the business) only.
    expect((await stranger.from("business_placements").select("id").eq("community_id", id)).data).toEqual([]);
    const shop = await signedIn(people.shop);
    const { data: invite } = await shop.from("business_placements").select("id, status").eq("community_id", id).single();
    expect(invite?.status).toBe("invited");

    // Only the business itself can accept.
    expect(await businesses.answerPartnerInvite(invite!.id, me(people.admin), true)).toMatchObject({ ok: false });
    expect(await businesses.answerPartnerInvite(invite!.id, me(people.shop), true)).toEqual({ ok: true });
    // Public community: anyone can see its partners now, and General announced it.
    expect((await stranger.from("business_placements").select("status").eq("community_id", id)).data).toEqual([{ status: "active" }]);
    const { data: general } = await admin().from("conversations").select("id").eq("community_id", id).eq("channel", "general").single();
    const { data: notes } = await admin().from("messages").select("content").eq("conversation_id", general!.id).ilike("content", "%official partner%");
    expect(notes).toHaveLength(1);

    // The business can leave.
    expect(await businesses.leavePlacement(invite!.id, me(people.shop))).toEqual({ ok: true });
    expect((await stranger.from("business_placements").select("id").eq("community_id", id)).data).toEqual([]);
  });
});
