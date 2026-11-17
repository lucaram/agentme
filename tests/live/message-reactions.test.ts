import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, dbUp, SUPABASE_URL } from "./env";
import { planBusinessFixture } from "../fixtures/plan-business";
import { createCommunity } from "@/lib/social/communities";
import { ReactionDetails, ReactionSummary } from "@/lib/chat/reactions";
import { GET } from "@/app/api/chats/[id]/reactions/route";
import { setMessageReaction } from "@/app/(app)/reaction-actions";
import type { Database } from "@/lib/database.types";

const session = vi.hoisted(() => ({ user: null as { id: string } | null, client: null as unknown }));
vi.mock("@/lib/auth", () => ({ getUser: async () => session.user }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));

describe.skipIf(!dbUp)("human message reactions", () => {
  let f: Awaited<ReturnType<typeof planBusinessFixture>>; let dm: string; let channel: string; let community: string;
  const clients: Record<string, ReturnType<typeof createClient<Database>>> = {};
  beforeAll(async () => {
    f = await planBusinessFixture();
    for (const [key, person] of Object.entries({ luca: f.luca, marco: f.marco, paul: f.paul, business: f.business })) {
      const client = createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
      const { error } = await client.auth.signInWithPassword({ email: person.email, password: f.password }); if (error) throw error; clients[key] = client;
    }
    const made = await createCommunity({ userId: f.luca.userId, agent: f.luca.agent }, { name: "Reaction tests", description: "Temporary reaction permissions tests", avatar: "💬", visibility: "private" });
    if (!made.ok) throw new Error(made.error); community = made.id;
    channel = (await f.db.from("conversations").select("id").eq("community_id", community).eq("channel", "general").single()).data!.id;
    dm = (await f.db.from("conversations").insert({ kind: "dm", created_by: f.luca.userId }).select("id").single()).data!.id;
    await f.db.from("conversation_members").insert([f.luca, f.marco].map((p) => ({ conversation_id: dm, user_id: p.userId })));
    await f.db.from("contacts").insert({ requester_agent: f.luca.agent.id, addressee_agent: f.marco.agent.id, status: "accepted" });
  });
  afterAll(async () => { if (f) { await f.db.from("communities").delete().eq("id", community); await f.cleanup(); } });
  async function message(conv = f.group, extra: Partial<Database["public"]["Tables"]["messages"]["Insert"]> = {}) {
    const { data, error } = await f.db.from("messages").insert({ conversation_id: conv, sender_user_id: f.luca.userId, content: "A shared message", is_ai_generated: false, ...extra }).select("id,created_at").single();
    if (error) throw error; return data!;
  }
  const summaries = async (id: string, who = "luca") => ReactionSummary.array().parse((await clients[who].rpc("get_message_reactions", { p_ids: [id] })).data);
  const react = (id: string, reaction: string | null = "heart", who = "luca") => clients[who].rpc("set_message_reaction", { p_message: id, p_reaction: reaction });
  function as(person: "luca" | "marco" | "business" | null) { session.user = person ? { id: f[person].userId } : null; session.client = person ? clients[person] : null; }
  const details = (id: string, conv = f.group, extra = "") => GET(new Request(`http://localhost:3000/api/chats/${conv}/reactions?message=${id}${extra}`), { params: Promise.resolve({ id: conv }) });

  it("adds, replaces and removes one reaction per human with database timestamps and live versions", async () => {
    const m = await message(); expect((await react(m.id)).error).toBeNull();
    expect((await react(m.id, "heart", "marco")).error).toBeNull();
    expect((await summaries(m.id))[0]).toMatchObject({ counts: { heart: 2 }, mine: "heart" });
    const original = (await f.db.from("message_reactions").select("reacted_at").eq("message_id", m.id).eq("user_id", f.luca.userId).single()).data!.reacted_at;
    expect((await react(m.id)).error).toBeNull();
    expect((await f.db.from("message_reactions").select("reacted_at").eq("message_id", m.id).eq("user_id", f.luca.userId).single()).data!.reacted_at).toBe(original);
    expect((await react(m.id, "laugh")).error).toBeNull(); expect((await summaries(m.id))[0]).toMatchObject({ counts: { heart: 1, laugh: 1 }, mine: "laugh" });
    expect((await react(m.id, null)).error).toBeNull(); expect((await summaries(m.id))[0]).toMatchObject({ counts: { heart: 1 }, mine: null });
    expect((await f.db.from("message_reaction_versions").select("revision").eq("conversation_id", f.group).single()).data!.revision).toBeGreaterThanOrEqual(4);
    expect((await f.db.from("messages").select("created_at").eq("id", m.id).single()).data!.created_at).toBe(m.created_at);
    expect((await f.db.from("messages").select("id").eq("conversation_id", f.group)).data).toHaveLength(1);
  });
  it("supports DMs, groups, communities, My Agent and business-agent output", async () => {
    for (const conv of [dm, f.group, channel, f.myAgent, f.direct]) {
      const m = await message(conv, { sender_user_id: null, sender_agent_id: f.business.agent.id, is_ai_generated: true });
      expect((await react(m.id, "up")).error).toBeNull(); expect((await summaries(m.id))[0].counts).toEqual({ up: 1 });
    }
  });
  it("rejects outsiders, anonymous callers, private, deleted and system messages; raw writes cannot forge identity or time", async () => {
    const m = await message();
    expect((await react(m.id, "angry", "business")).error).toBeTruthy(); expect(await summaries(m.id, "business")).toEqual([]);
    const anon = createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    expect((await anon.rpc("set_message_reaction", { p_message: m.id, p_reaction: "heart" })).error).toBeTruthy();
    expect((await react(m.id, "invalid")).error).toBeTruthy();
    for (const extra of [{ visible_to: f.luca.userId }, { removed_at: new Date().toISOString() }, { sender_user_id: null, sender_agent_id: null }]) {
      const hidden = await message(f.group, extra); expect((await react(hidden.id)).error).toBeTruthy(); expect(await summaries(hidden.id)).toEqual([]);
    }
    expect((await clients.luca.from("message_reactions").insert({ message_id: m.id, user_id: f.marco.userId, reaction: "heart", reacted_at: "2000-01-01T00:00:00Z" })).error).toBeTruthy();
    expect((await clients.luca.rpc("get_message_reactions", { p_ids: Array(51).fill(m.id) })).error).toBeTruthy();
    expect((await react(m.id)).error).toBeNull();
    expect((await f.db.from("messages").update({ removed_at: new Date().toISOString() }).eq("id", m.id)).error).toBeNull();
    expect((await f.db.from("message_reactions").select("*").eq("message_id", m.id)).data).toEqual([]);
  });
  it("honours closed DMs and mutes while still allowing removal of your existing reaction", async () => {
    const m = await message(dm); expect((await react(m.id)).error).toBeNull();
    const { data: contact } = await f.db.from("contacts").select("id").eq("requester_agent", f.luca.agent.id).eq("addressee_agent", f.marco.agent.id).single();
    await f.db.from("contacts").update({ status: "blocked", blocked_by: f.marco.agent.id }).eq("id", contact!.id);
    expect((await react(m.id, "down")).error).toBeTruthy(); expect((await react(m.id, null)).error).toBeNull();
    await f.db.from("contacts").update({ status: "accepted", blocked_by: null }).eq("id", contact!.id);
    const c = await message(channel); await f.db.from("community_members").update({ muted_until: new Date(Date.now() + 60000).toISOString() }).eq("community_id", community).eq("user_id", f.luca.userId);
    expect((await react(c.id)).error).toBeTruthy();
    await f.db.from("community_members").update({ muted_until: null }).eq("community_id", community).eq("user_id", f.luca.userId);
  });
  it("returns names and timestamps only to current viewers, and checks route scope and invalid input", async () => {
    const m = await message(); expect((await react(m.id, "happy", "marco")).error).toBeNull();
    as("luca"); const response = await details(m.id); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    const data = ReactionDetails.parse(await response.json()); expect(data.items[0]).toMatchObject({ name: "Marco", user_id: f.marco.userId, reaction: "happy" }); expect(data.items[0].reacted_at).toBeTruthy();
    expect((await details(m.id, f.direct)).status).toBe(404); expect((await details(m.id, f.group, "&offset=-1")).status).toBe(400);
    as("business"); expect((await details(m.id)).status).toBe(404); as(null); expect((await details(m.id)).status).toBe(401);
    as("luca"); expect(await setMessageReaction("invalid", "heart")).toHaveProperty("error");
    await f.db.from("conversation_members").delete().eq("conversation_id", f.group).eq("user_id", f.marco.userId);
    expect((await react(m.id, "sad", "marco")).error).toBeTruthy(); expect(await summaries(m.id, "marco")).toEqual([]);
    await f.db.from("conversation_members").insert({ conversation_id: f.group, user_id: f.marco.userId });
  });
  it("filters before paging and keeps filtered names within the caller's message access", async () => {
    const m = await message();
    expect((await react(m.id, "heart")).error).toBeNull(); expect((await react(m.id, "happy", "marco")).error).toBeNull(); expect((await react(m.id, "heart", "paul")).error).toBeNull();
    as("luca");
    const hearts = await details(m.id, f.group, "&reaction=heart"); expect(hearts.status).toBe(200);
    const allHearts = ReactionDetails.parse(await hearts.json()); expect(allHearts.items).toHaveLength(2); expect(allHearts.items.every((r) => r.reaction === "heart")).toBe(true);
    const second = ReactionDetails.parse(await (await details(m.id, f.group, "&reaction=heart&offset=1")).json()); expect(second.items.map((r) => r.user_id)).toEqual([allHearts.items[1].user_id]); expect(second.hasMore).toBe(false);
    const happy = ReactionDetails.parse(await (await details(m.id, f.group, "&reaction=happy")).json()); expect(happy.items).toEqual([expect.objectContaining({ user_id: f.marco.userId, name: "Marco", reaction: "happy" })]);
    expect((await details(m.id, f.group, "&reaction=unknown")).status).toBe(400);
    expect((await clients.luca.rpc("get_message_reaction_details", { p_message: m.id, p_offset: 0, p_reaction: "unknown" })).error).toBeTruthy();
    expect((await clients.business.rpc("get_message_reaction_details", { p_message: m.id, p_offset: 0, p_reaction: "heart" })).data).toEqual({ items: [], hasMore: false });
    as("business"); expect((await details(m.id, f.group, "&reaction=heart")).status).toBe(404);
    as(null); expect((await details(m.id, f.group, "&reaction=heart")).status).toBe(401);
  });
});
