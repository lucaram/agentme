/**
 * Community rules against the database: description required, core + picked
 * house rules saved as the rules people accept, "No links" enforced in code,
 * a house rule like "No spoilers" only nudges (mock model). Throwaway users.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, dbUp } from "./env";

type AgentRow = NonNullable<Awaited<ReturnType<typeof import("@/lib/data/agents").getAgentById>>>;
const run = Math.random().toString(36).slice(2, 7);
const people = {} as Record<"owner" | "member", { userId: string; agent: AgentRow }>;
let communityId = "";

const lib = async () => ({
  communities: await import("@/lib/social/communities"),
  guard: await import("@/lib/social/guard-server"),
  auto: await import("@/lib/social/moderation-server"),
});
const me = (k: "owner" | "member") => ({ userId: people[k].userId, agent: people[k].agent });

describe.skipIf(!dbUp)("community rules (live)", () => {
  beforeAll(async () => {
    const db = admin();
    for (const k of ["owner", "member"] as const) {
      const handle = `tr${run}_${k}`;
      const { data: created, error } = await db.auth.admin.createUser({ email: `${handle}@rules.test`, password: "rules-test-password", email_confirm: true });
      if (error) throw error;
      const { data: agent } = await db.from("agents").insert({ owner_id: created.user.id, handle, display_name: `Test ${k}`, avatar: "🦊" }).select("*").single();
      people[k] = { userId: created.user.id, agent: agent! };
    }
  });

  afterAll(async () => {
    const db = admin();
    if (communityId) await db.from("communities").delete().eq("id", communityId);
    const ids = Object.values(people).map((p) => p.userId);
    await db.from("conversations").delete().in("created_by", ids);
    for (const id of ids) await db.auth.admin.deleteUser(id);
  });

  it("needs a real description; saves the core rules plus the picked house rules and the language", async () => {
    const { communities } = await lib();
    const base = { name: `Rules FC ${run}`, avatar: "🏟️", visibility: "public" as const };
    expect(await communities.createCommunity(me("owner"), { ...base, description: "Fans" })).toMatchObject({ ok: false, error: expect.stringContaining("at least 20") });
    const made = await communities.createCommunity(me("owner"), { ...base, description: "Match days and banter for Milan fans", houseRules: ["no_spoilers", "no_links"], language: "it" });
    expect(made.ok).toBe(true);
    communityId = (made as { id: string }).id;
    const { data } = await admin().from("communities").select("rules, house_rules, language").eq("id", communityId).single();
    expect(data).toEqual({ rules: "Be respectful.\nNo spam or selling.\nStay on topic.\nNo spoilers.\nNo links.", house_rules: ["no_spoilers", "no_links"], language: "it" });
    expect(await communities.joinCommunity(communityId, me("member"), { acceptRules: false })).toMatchObject({ ok: false });
    expect(await communities.joinCommunity(communityId, me("member"), { acceptRules: true })).toMatchObject({ ok: true });
  });

  it("“No links” is enforced in code, even for a regular member (moderators are exempt)", async () => {
    const { guard } = await lib();
    await admin().from("community_members").update({ joined_at: new Date(Date.now() - 3 * 86_400_000).toISOString() }).eq("community_id", communityId).eq("user_id", people.member.userId);
    const { data: general } = await admin().from("conversations").select("id").eq("community_id", communityId).eq("channel", "general").single();
    for (const t of ["Ciao", "Forza", "Andiamo"]) await admin().from("messages").insert({ conversation_id: general!.id, sender_user_id: people.member.userId, content: t, is_ai_generated: false });
    expect(await guard.communityTrust(communityId, people.member.userId)).toBe("member");
    expect(await guard.guardCommunityPost(communityId, people.member.userId, "Tickets: https://club.example/tickets")).toMatchObject({ ok: false, error: expect.stringContaining("doesn't allow links") });
    expect(await guard.guardCommunityPost(communityId, people.owner.userId, "Official: https://club.example/news")).toMatchObject({ ok: true });
  });

  it("“No spoilers” only nudges (a house rule never refuses)", async () => {
    const { auto } = await lib();
    const { data: general } = await admin().from("conversations").select("id").eq("community_id", communityId).eq("channel", "general").single();
    expect(await auto.autopilot({ communityId, conversationId: general!.id, userId: people.member.userId, text: "Spoiler: the final score was 3-1", level: "member", confirmed: false })).toMatchObject({
      action: "nudge",
      rule: "No spoilers",
    });
  });
});
