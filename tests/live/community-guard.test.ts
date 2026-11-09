/**
 * Community spam guard against the database: trust levels from a member's own
 * history, slow mode, links for new members, repeats. Throwaway users.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, dbUp } from "./env";

type AgentRow = NonNullable<Awaited<ReturnType<typeof import("@/lib/data/agents").getAgentById>>>;
const run = Math.random().toString(36).slice(2, 7);
const people = {} as Record<"owner" | "member" | "fresh", { userId: string; agent: AgentRow }>;
let communityId = "";
let general = "";

const lib = async () => ({ guard: await import("@/lib/social/guard-server"), communities: await import("@/lib/social/communities") });
const me = (k: keyof typeof people) => ({ userId: people[k].userId, agent: people[k].agent });

describe.skipIf(!dbUp)("community spam guard (live)", () => {
  beforeAll(async () => {
    const db = admin();
    for (const key of ["owner", "member", "fresh"] as const) {
      const handle = `tg${run}_${key}`.slice(0, 20);
      const { data: created, error } = await db.auth.admin.createUser({ email: `${handle}@guard.test`, password: "guard-test-password", email_confirm: true });
      if (error) throw error;
      const { data: agent } = await db.from("agents").insert({ owner_id: created.user.id, handle, display_name: `Test ${key}`, avatar: "🦊" }).select("*").single();
      people[key] = { userId: created.user.id, agent: agent! };
    }
    const { communities } = await lib();
    const made = await communities.createCommunity(me("owner"), { name: `Guard ${run}`, description: "A test community about football and match days", avatar: "🏟️", visibility: "public" });
    communityId = (made as { id: string }).id;
    for (const k of ["member", "fresh"] as const) await communities.joinCommunity(communityId, me(k), { acceptRules: true });
    general = (await db.from("conversations").select("id").eq("community_id", communityId).eq("channel", "general").single()).data!.id;
  });

  afterAll(async () => {
    const db = admin();
    if (communityId) await db.from("communities").delete().eq("id", communityId);
    const ids = Object.values(people).map((p) => p.userId);
    await db.from("conversations").delete().in("created_by", ids);
    for (const id of ids) await db.auth.admin.deleteUser(id);
  });

  it("moderators are exempt; a member who just joined is new and can't post links", async () => {
    const { guard } = await lib();
    expect(await guard.communityTrust(communityId, people.owner.userId)).toBe("moderator");
    expect(await guard.communityTrust(communityId, people.member.userId)).toBe("new");
    expect(await guard.guardCommunityPost(communityId, people.member.userId, "Highlights: https://clip.example/goal")).toMatchObject({ ok: false, error: expect.stringContaining("New members") });
    expect(await guard.guardCommunityPost(communityId, people.owner.userId, "Rules: https://club.example/rules https://club.example/faq")).toMatchObject({ ok: true, flags: [] });
  });

  it("after a day and a few messages: a member, links allowed; repeats blocked", async () => {
    const { guard } = await lib();
    const db = admin();
    await db.from("community_members").update({ joined_at: new Date(Date.now() - 48 * 3_600_000).toISOString() }).eq("community_id", communityId).eq("user_id", people.member.userId);
    for (const text of ["Hi all", "Great game", "See you Saturday"]) {
      const { error } = await db.from("messages").insert({ conversation_id: general, sender_user_id: people.member.userId, content: text, is_ai_generated: false });
      if (error) throw error;
    }
    expect(await guard.communityTrust(communityId, people.member.userId)).toBe("member");
    expect(await guard.guardCommunityPost(communityId, people.member.userId, "Highlights: https://clip.example/goal")).toMatchObject({ ok: true, flags: [] });
    expect(await guard.guardCommunityPost(communityId, people.member.userId, "see you saturday!")).toMatchObject({ ok: false, error: expect.stringContaining("just posted") });
    expect(await guard.guardCommunityPost(communityId, people.member.userId, "Two tickets for sale, £30")).toMatchObject({ ok: true, flags: ["selling"] });
  });

  it("a removed message puts a member back on the new-member rules", async () => {
    const { guard } = await lib();
    await admin().from("messages").update({ removed_at: new Date().toISOString() }).eq("conversation_id", general).eq("sender_user_id", people.member.userId).eq("content", "Hi all");
    expect(await guard.communityTrust(communityId, people.member.userId)).toBe("new");
  });

  it("slow mode: new members can post 3 messages a minute", async () => {
    const { guard } = await lib();
    for (const n of [1, 2, 3]) expect(await guard.guardCommunityPost(communityId, people.fresh.userId, `Message ${n}`)).toMatchObject({ ok: true });
    expect(await guard.guardCommunityPost(communityId, people.fresh.userId, "Message 4")).toMatchObject({ ok: false, error: expect.stringContaining("Slow mode") });
  });
});
