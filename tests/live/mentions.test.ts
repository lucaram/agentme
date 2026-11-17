import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, dbUp, SUPABASE_URL } from "./env";
import { planBusinessFixture } from "../fixtures/plan-business";
import { MentionState } from "@/lib/chat/mentions";
import { preparePersonAsk } from "@/lib/agents/ask-person";
import type { Database } from "@/lib/database.types";

describe.skipIf(!dbUp)("people mentions and explicit agent requests", () => {
  let f: Awaited<ReturnType<typeof planBusinessFixture>>; const clients: Record<string, ReturnType<typeof createClient<Database>>> = {};
  beforeAll(async () => {
    f = await planBusinessFixture();
    for (const [key, person] of Object.entries({ luca: f.luca, marco: f.marco, paul: f.paul, business: f.business })) { const c = createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } }); const result = await c.auth.signInWithPassword({ email: person.email, password: f.password }); if (result.error) throw result.error; clients[key] = c; }
    expect((await f.db.from("contacts").insert({ requester_agent: f.luca.agent.id, addressee_agent: f.marco.agent.id, status: "accepted" })).error).toBeNull();
  });
  afterAll(async () => { await f?.cleanup(); });
  async function message(content: string, extra = {}, conv?: string) { const { data, error } = await f.db.from("messages").insert({ conversation_id: conv ?? f.group, sender_user_id: f.luca.userId, content, is_ai_generated: false, ...extra }).select("id").single(); if (error) throw error; return data!.id; }
  const state = async (who = "marco", claim = false) => { const result = await clients[who].rpc("mention_state", { p_claim: claim }); if (result.error) throw result.error; return MentionState.parse(result.data); };
  it("creates one notification per eligible person, never calls an agent, and hides unread state from other members", async () => {
    const id = await message(`Hi @${f.marco.agent.handle}, cc @${f.marco.agent.handle.toUpperCase()} and @${f.business.agent.handle}`);
    expect((await f.db.from("message_mentions").select("user_id").eq("message_id", id)).data).toEqual([{ user_id: f.marco.userId }]);
    expect((await state()).chats.find((c) => c.conversation_id === f.group)?.total).toBe(1);
    expect((await clients.luca.from("mention_alerts").select("*").eq("message_id", id)).data).toEqual([]);
    expect((await clients.business.from("message_mentions").select("*").eq("message_id", id)).data).toEqual([]);
    expect((await clients.marco.from("mention_alerts").update({ seen_at: new Date().toISOString() }).eq("message_id", id)).error).toBeTruthy();
    expect((await f.db.from("task_exchanges").select("id").eq("from_agent", f.luca.agent.id)).data).toEqual([]);
  });
  it("does not notify from private instructions, My Agent, forwarded content, quoted lines, code, emails or non-member handles", async () => {
    const h = f.marco.agent.handle;
    const ids = await Promise.all([message(`@${h}`, { visible_to: f.luca.userId }), message(`@${h}`, { metadata: { forwarded: {} } }), message(`@${h}`, {}, f.myAgent), message(`\`@${h}\` and name@${h}`), message(`> @${h}`), message(`@${h}`, { sender_user_id: null, sender_agent_id: f.luca.agent.id, is_ai_generated: true }), message(`@${h}`, { removed_at: new Date().toISOString() })]);
    expect((await f.db.from("mention_alerts").select("message_id").in("message_id", ids)).data).toEqual([]);
  });
  it("claims each banner once across sessions while keeping the mention unread until it is visibly viewed", async () => {
    await state("marco", true); const id = await message(`@${f.marco.agent.handle} another question`);
    const [a, b] = await Promise.all([state("marco", true), state("marco", true)]); expect([...a.alerts, ...b.alerts].filter((n) => n.message_id === id)).toHaveLength(1);
    expect((await clients.marco.rpc("acknowledge_messages", { p_ids: [id], p_seen: false })).error).toBeNull(); expect((await f.db.from("mention_alerts").select("seen_at").eq("message_id", id).single()).data!.seen_at).toBeNull();
    expect((await clients.marco.rpc("set_read_receipts", { p_enabled: false })).error).toBeNull();
    expect((await clients.marco.rpc("acknowledge_messages", { p_ids: [id], p_seen: true })).error).toBeNull(); expect((await f.db.from("mention_alerts").select("seen_at").eq("message_id", id).single()).data!.seen_at).toBeTruthy();
  });
  it("respects mute and notification preferences without losing unread badges", async () => {
    await f.db.from("conversation_members").update({ muted: true }).eq("conversation_id", f.group).eq("user_id", f.marco.userId);
    const muted = await message(`@${f.marco.agent.handle} muted mention`); expect((await state("marco", true)).alerts.some((a) => a.message_id === muted)).toBe(false);
    await f.db.from("conversation_members").update({ muted: false }).eq("conversation_id", f.group).eq("user_id", f.marco.userId);
    expect((await clients.marco.from("mention_preferences").upsert({ user_id: f.marco.userId, enabled: false })).error).toBeNull();
    const off = await message(`@${f.marco.agent.handle} preference disabled`); const next = await state("marco", true); expect(next.alerts.some((a) => a.message_id === off)).toBe(false); expect(next.chats.some((c) => c.conversation_id === f.group && c.total > 0)).toBe(true);
    await clients.marco.from("mention_preferences").upsert({ user_id: f.marco.userId, enabled: true });
  });
  it("scopes suggestions to members, contacts or placed businesses and preserves identities across handle changes", async () => {
    const suggestions = await clients.luca.rpc("mention_suggestions", { p_conversation: f.group, p_query: "Marco" }); expect(suggestions.error).toBeNull(); expect(suggestions.data).toEqual([expect.objectContaining({ id: f.marco.agent.id, can_ask: true })]);
    expect((await clients.business.rpc("mention_suggestions", { p_conversation: f.group })).error).toBeTruthy();
    const id = await message(`@${f.marco.agent.handle} stable identity`); const renamed = `${f.marco.agent.handle}_x`;
    await f.db.from("agents").update({ handle: renamed }).eq("id", f.marco.agent.id);
    expect((await f.db.from("message_mentions").select("handle,user_id").eq("message_id", id).single()).data).toEqual({ handle: f.marco.agent.handle, user_id: f.marco.userId });
    await f.db.from("agents").update({ handle: f.marco.agent.handle }).eq("id", f.marco.agent.id);
    await f.db.from("messages").update({ removed_at: new Date().toISOString() }).eq("id", id); expect((await f.db.from("mention_alerts").select("message_id").eq("message_id", id)).data).toEqual([]);
  });
  it("both asking phrasings create private approval cards with no outgoing request beforehand", async () => {
    for (const who of [`@${f.marco.agent.handle}`, `@${f.marco.agent.handle}’s agent`]) expect(await preparePersonAsk({ userId: f.luca.userId, agent: f.luca.agent, conversationId: f.myAgent, text: `Ask ${who} whether he’s available for dinner on Saturday` })).toBe(true);
    const tasks = (await f.db.from("tasks").select("status,parsed").eq("owner_id", f.luca.userId).eq("status", "awaiting_approval")).data!; expect(tasks).toHaveLength(2); expect(tasks.every((t) => (t.parsed as { question: string }).question === "Are you available for dinner on Saturday?")).toBe(true);
    expect((await f.db.from("task_exchanges").select("id").eq("from_agent", f.luca.agent.id)).data).toEqual([]);
    expect(await preparePersonAsk({ userId: f.luca.userId, agent: f.luca.agent, conversationId: f.group, privateCard: true, text: `Ask @${f.marco.agent.handle} if he can bring dessert` })).toBe(true);
    expect((await f.db.from("messages").select("visible_to").eq("conversation_id", f.group).eq("metadata->>kind", "task_card").single()).data!.visible_to).toBe(f.luca.userId);
  });
});
