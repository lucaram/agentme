/**
 * Community autopilot against the database (mock model): refuse, nudge, post
 * after "Post anyway", trusted members skip the check, and members' reports
 * hide a message only when enough people report it AND the check agrees.
 * Throwaway users and community.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, SUPABASE_URL, admin, dbUp } from "./env";

type AgentRow = NonNullable<Awaited<ReturnType<typeof import("@/lib/data/agents").getAgentById>>>;
const run = Math.random().toString(36).slice(2, 7);
const KEYS = ["owner", "author", "r1", "r2", "r3"] as const;
const people = {} as Record<(typeof KEYS)[number], { userId: string; email: string; agent: AgentRow }>;
let communityId = "";
let general = "";

const lib = async () => ({
  auto: await import("@/lib/social/moderation-server"),
  shared: await import("@/lib/social/shared"),
  communities: await import("@/lib/social/communities"),
  chat: await import("@/lib/data/chat"),
});
const me = (k: (typeof KEYS)[number]) => ({ userId: people[k].userId, agent: people[k].agent });
const events = async (action: string) =>
  (await admin().from("moderation_events").select("verdict, excerpt").eq("community_id", communityId).eq("action", action)).data ?? [];

describe.skipIf(!dbUp)("community autopilot (live)", () => {
  beforeAll(async () => {
    const db = admin();
    for (const key of KEYS) {
      const handle = `ta${run}_${key}`.slice(0, 20);
      const email = `${handle}@autopilot.test`;
      const { data: created, error } = await db.auth.admin.createUser({ email, password: "autopilot-password", email_confirm: true });
      if (error) throw error;
      const { data: agent } = await db.from("agents").insert({ owner_id: created.user.id, handle, display_name: `Test ${key}`, avatar: "🦊" }).select("*").single();
      people[key] = { userId: created.user.id, email, agent: agent! };
    }
    const { communities } = await lib();
    const made = await communities.createCommunity(me("owner"), { name: `Autopilot ${run}`, description: "A test community about football and match days", avatar: "🏟️", visibility: "public" });
    communityId = (made as { id: string }).id;
    for (const k of ["author", "r1", "r2", "r3"] as const) await communities.joinCommunity(communityId, me(k), { acceptRules: true });
    general = (await db.from("conversations").select("id").eq("community_id", communityId).eq("channel", "general").single()).data!.id;
  });

  afterAll(async () => {
    const db = admin();
    if (communityId) await db.from("communities").delete().eq("id", communityId);
    const ids = Object.values(people).map((p) => p.userId);
    await db.from("conversations").delete().in("created_by", ids);
    for (const id of ids) await db.auth.admin.deleteUser(id);
  });

  const post = async (text: string, level: "new" | "member" | "trusted" | "moderator" = "new", confirmed = false) => {
    const { auto } = await lib();
    return auto.autopilot({ communityId, conversationId: general, userId: people.author.userId, text, level, confirmed });
  };

  it("refuses near-certain spam, nudges rudeness, posts after “Post anyway”, and logs each", async () => {
    expect(await post("Click here for free money!!")).toMatchObject({ action: "refuse", message: expect.stringContaining("spam") });
    expect(await post("You're an idiot")).toMatchObject({ action: "nudge", rule: "Be respectful" });
    expect(await post("You're an idiot", "new", true)).toEqual({ action: "post", flags: ["disrespectful"] });
    expect(await post("What a goal!")).toEqual({ action: "post", flags: [] });
    expect((await events("refused")).map((e) => e.verdict)).toEqual(["spam"]);
    expect((await events("nudged")).map((e) => e.excerpt)).toEqual(["You're an idiot"]);
    expect((await events("posted_after_nudge")).map((e) => e.verdict)).toEqual(["disrespectful"]);
  });

  it("trusted members and moderators skip the check", async () => {
    expect(await post("You're an idiot", "trusted")).toEqual({ action: "post", flags: [] });
    expect(await post("Click here for free money", "moderator")).toEqual({ action: "post", flags: [] });
  });

  it("members' reports hide a message only when 3 different people report it and the check agrees", async () => {
    const { shared, chat } = await lib();
    const rude = await chat.postMessage({ conversationId: general, from: "human", userId: people.author.userId, content: "Shut up, you clown" });
    const fine = await chat.postMessage({ conversationId: general, from: "human", userId: people.author.userId, content: "Great match today" });
    const removed = async (id: string) => (await admin().from("messages").select("removed_at").eq("id", id).single()).data?.removed_at;

    await shared.reportMessage(rude.id, people.r1.userId, "rude");
    await shared.reportMessage(rude.id, people.r2.userId, "rude");
    expect(await removed(rude.id)).toBeNull(); // two isn't enough
    await shared.reportMessage(rude.id, people.r3.userId, "rude");
    expect(await removed(rude.id)).not.toBeNull();
    expect((await events("hidden_after_reports")).length).toBe(1);

    for (const r of ["r1", "r2", "r3"] as const) await shared.reportMessage(fine.id, people[r].userId, "I don't like it");
    expect(await removed(fine.id)).toBeNull(); // the check doesn't agree: it stays
  });

  it("only the community's moderators see what the autopilot did", async () => {
    const as = async (k: (typeof KEYS)[number]) => {
      const c = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
      await c.auth.signInWithPassword({ email: people[k].email, password: "autopilot-password" });
      return c;
    };
    expect(((await (await as("owner")).from("moderation_events").select("id").eq("community_id", communityId)).data ?? []).length).toBeGreaterThan(0);
    expect((await (await as("r1")).from("moderation_events").select("id").eq("community_id", communityId)).data).toEqual([]);
  });
});
