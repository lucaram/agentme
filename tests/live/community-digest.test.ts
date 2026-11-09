/**
 * Community moderation step 3 against the database (mock model): appeals
 * (author only, once; a moderator accepts or rejects; nobody answering for 3
 * days resolves it by the author's history), the daily digest, and owners of
 * communities whose moderators have gone quiet. Throwaway users and community;
 * housekeeping is limited to this community so nothing else is touched.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, dbUp } from "./env";

type AgentRow = NonNullable<Awaited<ReturnType<typeof import("@/lib/data/agents").getAgentById>>>;
const run = Math.random().toString(36).slice(2, 7);
const KEYS = ["owner", "author", "regular", "other"] as const;
const people = {} as Record<(typeof KEYS)[number], { userId: string; agent: AgentRow }>;
let communityId = "";
let general = "";
const DAY = 86_400_000;

const lib = async () => ({
  auto: await import("@/lib/social/moderation-server"),
  appeals: await import("@/lib/social/appeals"),
  digest: await import("@/lib/social/digest"),
  communities: await import("@/lib/social/communities"),
});
const me = (k: (typeof KEYS)[number]) => ({ userId: people[k].userId, agent: people[k].agent });
const refuse = async (k: (typeof KEYS)[number], text: string) => {
  const { auto } = await lib();
  const out = await auto.autopilot({ communityId, conversationId: general, userId: people[k].userId, text, level: "new", confirmed: false });
  if (out.action !== "refuse" || !out.eventId) throw new Error("expected a refusal");
  return out.eventId;
};
const event = async (id: string) => (await admin().from("moderation_events").select("appeal_status, appeal_resolved_by").eq("id", id).single()).data!;
const postedBy = async (k: (typeof KEYS)[number], text: string) =>
  ((await admin().from("messages").select("id").eq("conversation_id", general).eq("sender_user_id", people[k].userId).eq("content", text)).data ?? []).length;
const notices = async (k: (typeof KEYS)[number]) => ((await admin().from("notices").select("text").eq("user_id", people[k].userId)).data ?? []).map((n) => n.text);

describe.skipIf(!dbUp)("community appeals, digest and quiet moderators (live)", () => {
  beforeAll(async () => {
    const db = admin();
    for (const key of KEYS) {
      const handle = `td${run}_${key}`.slice(0, 20);
      const { data: created, error } = await db.auth.admin.createUser({ email: `${handle}@digest.test`, password: "digest-password", email_confirm: true });
      if (error) throw error;
      const { data: agent } = await db.from("agents").insert({ owner_id: created.user.id, handle, display_name: `Test ${key}`, avatar: "🦊" }).select("*").single();
      people[key] = { userId: created.user.id, agent: agent! };
    }
    const { communities } = await lib();
    const made = await communities.createCommunity(me("owner"), { name: `Digest ${run}`, description: "Football", rules: "Be respectful.", avatar: "🏟️", visibility: "public" });
    communityId = (made as { id: string }).id;
    for (const k of ["author", "regular", "other"] as const) await communities.joinCommunity(communityId, me(k), { acceptRules: true });
    general = (await db.from("conversations").select("id").eq("community_id", communityId).eq("channel", "general").single()).data!.id;
  });

  afterAll(async () => {
    const db = admin();
    if (communityId) await db.from("communities").delete().eq("id", communityId);
    const ids = Object.values(people).map((p) => p.userId);
    await db.from("notices").delete().in("user_id", ids);
    await db.from("conversations").delete().in("created_by", ids);
    for (const id of ids) await db.auth.admin.deleteUser(id);
  });

  it("only the author can appeal, and only once; a moderator's Accept posts the message", async () => {
    const { appeals } = await lib();
    const id = await refuse("author", "Click here for free money, honest");
    expect(await appeals.appeal(id, people.other.userId)).toMatchObject({ ok: false });
    expect(await appeals.appeal(id, people.author.userId)).toEqual({ ok: true });
    expect(await appeals.appeal(id, people.author.userId)).toMatchObject({ ok: false, error: expect.stringContaining("already") });
    expect((await notices("owner")).some((t) => t.includes("appealed"))).toBe(true);
    expect(await appeals.resolveAppeal(id, people.other.userId, true)).toMatchObject({ ok: false }); // not a moderator
    expect(await appeals.resolveAppeal(id, people.owner.userId, true)).toEqual({ ok: true });
    expect(await event(id)).toEqual({ appeal_status: "accepted", appeal_resolved_by: people.owner.userId });
    expect(await postedBy("author", "Click here for free money, honest")).toBe(1);
    expect((await notices("author")).some((t) => t.includes("accepted"))).toBe(true);
  });

  it("nobody answers for 3 days: accepted for a good history, rejected otherwise", async () => {
    const { appeals } = await lib();
    const db = admin();
    // "regular": a week in, several messages, nothing else refused.
    await db.from("community_members").update({ joined_at: new Date(Date.now() - 10 * DAY).toISOString() }).eq("community_id", communityId).eq("user_id", people.regular.userId);
    for (let i = 0; i < 6; i++) await db.from("messages").insert({ conversation_id: general, sender_user_id: people.regular.userId, content: `Match chat ${i}`, is_ai_generated: false });
    const good = await refuse("regular", "Click here for free money at the stadium");
    const bad = await refuse("other", "Click here for free money now");
    await appeals.appeal(good, people.regular.userId);
    await appeals.appeal(bad, people.other.userId);
    expect(await appeals.autoResolveAppeals([communityId])).toBe(0); // not 3 days yet
    await db.from("moderation_events").update({ appealed_at: new Date(Date.now() - 4 * DAY).toISOString() }).in("id", [good, bad]);
    expect(await appeals.autoResolveAppeals([communityId])).toBe(2);
    expect(await event(good)).toEqual({ appeal_status: "accepted", appeal_resolved_by: null });
    expect(await postedBy("regular", "Click here for free money at the stadium")).toBe(1);
    expect(await event(bad)).toEqual({ appeal_status: "rejected", appeal_resolved_by: null });
    expect(await postedBy("other", "Click here for free money now")).toBe(0);
  });

  it("one daily digest for moderators, not alerts per message", async () => {
    const { digest } = await lib();
    expect(await digest.sendDigests([communityId])).toBe(1);
    const text = (await notices("owner")).find((t) => t.startsWith("🤖 Digest"));
    expect(text).toMatch(/kept \d+ messages out/);
    expect(await digest.sendDigests([communityId])).toBe(0); // once a day
    expect((await notices("author")).some((t) => t.startsWith("🤖 Digest"))).toBe(false); // moderators only
  });

  it("quiet moderators: the owner is reminded, then offered active members to promote", async () => {
    const { digest } = await lib();
    const db = admin();
    expect(await digest.nudgeInactiveModerators([communityId])).toBe(0); // the owner was just here
    await db.from("community_members").update({ last_seen_at: new Date(Date.now() - 40 * DAY).toISOString() }).eq("community_id", communityId).eq("user_id", people.owner.userId);
    // "regular" is active and clean (their appealed message was accepted, but it still counts as refused this month).
    await db.from("community_members").update({ last_seen_at: new Date().toISOString() }).eq("community_id", communityId).eq("user_id", people.regular.userId);
    for (let i = 0; i < 6; i++) await db.from("messages").insert({ conversation_id: general, sender_user_id: people.regular.userId, content: `More chat ${i}`, is_ai_generated: false });
    expect(await digest.nudgeInactiveModerators([communityId])).toBe(1);
    expect((await notices("owner")).some((t) => t.includes("hasn't had a moderator around"))).toBe(true);
    expect(await digest.nudgeInactiveModerators([communityId])).toBe(0); // at most every 2 weeks
    // Suggestions skip anyone refused or hidden this month.
    expect((await digest.suggestModerators(communityId)).map((s) => s.userId)).not.toContain(people.other.userId);
  });

  it("an appeal's update for moderators is pinned until no appeal is left waiting", async () => {
    const db = admin();
    const { data: pinned } = await db.from("notices").select("resolved_at").eq("user_id", people.owner.userId).eq("kind", "appeal");
    // All appeals in this community were settled by the earlier tests: their updates are handled.
    expect(pinned?.length).toBeGreaterThan(0);
    expect(pinned?.every((n) => n.resolved_at !== null)).toBe(true);
  });
});

describe.skipIf(!dbUp)("updates: badges skip cleared and muted ones (live)", () => {
  it("tab badge counts new updates, not cleared ones, not from a muted group", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const { ANON_KEY, SUPABASE_URL } = await import("./env");
    const shared = await import("@/lib/social/shared");
    const notices = await import("@/lib/social/notices");
    const db = admin();
    const handle = `tn${run}`.slice(0, 20);
    const email = `${handle}@notices.test`;
    const { data: created } = await db.auth.admin.createUser({ email, password: "notices-password", email_confirm: true });
    const userId = created.user!.id;
    try {
      const { data: g } = await db.from("conversations").insert({ kind: "group", title: "Muted group", created_by: userId }).select("id").single();
      await db.from("conversation_members").insert({ conversation_id: g!.id, user_id: userId, role: "owner" });
      await shared.notify([userId], "groups", "One", `/groups/${g!.id}`);
      await shared.notify([userId], "groups", "Two", `/groups/${g!.id}`);
      const { data: rows } = await db.from("notices").select("id, ref_id, kind").eq("user_id", userId);
      expect(rows?.every((r) => r.ref_id === g!.id && r.kind === "info")).toBe(true);
      const c = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
      await c.auth.signInWithPassword({ email, password: "notices-password" });
      const badge = async () => Number((await c.rpc("action_counts")).data?.[0]?.groups ?? 0);
      expect(await badge()).toBe(2);
      await notices.dismissNotices(userId, "groups", rows![0].id);
      expect(await badge()).toBe(1);
      await db.from("conversation_members").update({ muted: true }).eq("conversation_id", g!.id).eq("user_id", userId);
      expect(await badge()).toBe(0); // muted: still listed, not counted
      await notices.dismissNotices(userId, "groups");
      expect((await db.from("notices").select("id").eq("user_id", userId).is("dismissed_at", null)).data).toEqual([]);
    } finally {
      await db.from("conversations").delete().eq("created_by", userId);
      await db.auth.admin.deleteUser(userId);
    }
  });

});
