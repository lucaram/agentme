import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, dbUp, SUPABASE_URL } from "./env";
import { planBusinessFixture } from "../fixtures/plan-business";
import { ReceiptSchema } from "@/lib/chat/receipts";
import type { Database } from "@/lib/database.types";

describe.skipIf(!dbUp)("authorised delivery and viewing receipts", () => {
  let f: Awaited<ReturnType<typeof planBusinessFixture>>;
  const clients: Record<string, ReturnType<typeof createClient<Database>>> = {};
  beforeAll(async () => {
    f = await planBusinessFixture();
    for (const [name, person] of Object.entries({ luca: f.luca, marco: f.marco, paul: f.paul, business: f.business })) {
      const client = createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
      const { error } = await client.auth.signInWithPassword({ email: person.email, password: f.password }); if (error) throw error;
      clients[name] = client;
    }
  });
  afterAll(async () => { await f?.cleanup(); });
  async function message(content: string, conversation = f.group, extra: Partial<Database["public"]["Tables"]["messages"]["Insert"]> = {}) {
    const { data, error } = await f.db.from("messages").insert({ conversation_id: conversation, sender_user_id: f.luca.userId, content, is_ai_generated: Boolean(extra.sender_agent_id), ...extra }).select("id").single();
    if (error) throw error; return data!.id;
  }
  async function status(id: string) {
    const result = await clients.luca.rpc("get_message_receipts", { p_ids: [id], p_details: true });
    expect(result.error).toBeNull(); return ReceiptSchema.array().parse(result.data)[0];
  }
  async function ack(id: string, person = "marco", seen = true) {
    const result = await clients[person].rpc("acknowledge_messages", { p_ids: [id], p_seen: seen });
    expect(result.error).toBeNull(); return result.data;
  }
  it("requires explicit acknowledgements, preserves first viewing times and counts each group member once", async () => {
    const id = await message("Group receipt test");
    expect(await status(id)).toMatchObject({ total: 2, delivered: 0, seen: 0 });
    const pending = await clients.marco.rpc("pending_message_deliveries", {});
    expect(pending.error).toBeNull(); expect(pending.data?.find((m) => m.id === id)?.content).toBe("Group receipt test");
    expect(await status(id)).toMatchObject({ delivered: 0, seen: 0 }); // Fetching alone is not an acknowledgement.
    await ack(id, "marco", false); expect(await status(id)).toMatchObject({ delivered: 1, seen: 0 });
    await ack(id); const first = await status(id); expect(first).toMatchObject({ delivered: 1, seen: 1 });
    await ack(id); expect((await status(id)).recipients).toEqual(first.recipients);
    await ack(id, "paul"); expect(await status(id)).toMatchObject({ total: 2, delivered: 2, seen: 2 });
    expect((await status(id)).recipients.map((p) => p.name).sort()).toEqual(["Marco", "Paul"]);
    expect((await clients.marco.rpc("pending_message_deliveries", {})).data?.some((m) => m.id === id)).toBe(false);
  });
  it("does not expose raw receipts or permit acknowledgements on someone else's behalf", async () => {
    const id = await message("Private receipt data");
    expect(await ack(id, "business")).toEqual([]); expect(await ack(id, "luca")).toEqual([]);
    expect((await clients.marco.rpc("get_message_receipts", { p_ids: [id], p_details: true })).data).toEqual([]);
    expect((await clients.business.rpc("get_message_receipts", { p_ids: [id] })).data).toEqual([]);
    for (const table of ["message_receipts", "message_receipt_tracking"] as const) expect((await clients.marco.from(table).select("*")).error?.code).toBe("42501");
    expect((await clients.marco.rpc("record_agent_receipt", { p_message: id, p_agent: f.business.agent.id })).error).toBeTruthy();
    expect((await clients.marco.rpc("link_business_receipt", { p_inbox: crypto.randomUUID() })).error).toBeTruthy();
    expect((await clients.marco.from("message_views").select("*").eq("user_id", f.paul.userId)).data).toEqual([]);
    expect((await clients.business.from("message_receipt_versions").select("*").eq("conversation_id", f.group)).data).toEqual([]);
    expect((await clients.marco.rpc("acknowledge_messages", { p_ids: Array.from({ length: 101 }, () => id), p_seen: true })).error).toBeTruthy();
    const anon = createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    expect((await anon.rpc("get_message_receipts", { p_ids: [id] })).error).toBeTruthy();
    expect((await anon.rpc("acknowledge_messages", { p_ids: [id], p_seen: true })).error).toBeTruthy();
  });
  it("keeps unread tracking private when read receipts are disabled, without retroactively publishing views", async () => {
    const id = await message("Privacy off"); await ack(id);
    expect(await status(id)).toMatchObject({ seen: 1 });
    expect((await clients.marco.rpc("set_read_receipts", { p_enabled: false })).error).toBeNull();
    await ack(id); expect(await status(id)).toMatchObject({ delivered: 1, seen: 0 });
    expect((await status(id)).recipients.find((p) => p.name === "Marco")).toMatchObject({ seen_at: null, seen_shared: false });
    expect((await clients.marco.from("message_views").select("viewed_at").eq("message_id", id).single()).data?.viewed_at).toBeTruthy();
    expect((await clients.marco.from("receipt_preferences").select("*").neq("user_id", f.marco.userId)).data).toEqual([]);
    await clients.marco.rpc("set_read_receipts", { p_enabled: true }); expect(await status(id)).toMatchObject({ seen: 0 });
    await ack(id); expect(await status(id)).toMatchObject({ seen: 1 });
  });
  it("keeps original audiences, excludes private/removed messages and revokes departed members' access", async () => {
    const id = await message("Original audience");
    await f.db.from("conversation_members").insert({ conversation_id: f.group, user_id: f.business.userId });
    await ack(id, "business"); expect(await status(id)).toMatchObject({ total: 2, delivered: 0, seen: 0 });
    await f.db.from("conversation_members").delete().eq("conversation_id", f.group).eq("user_id", f.business.userId);
    const privateId = await message("Private", f.group, { visible_to: f.luca.userId });
    expect(await status(privateId)).toBeUndefined(); expect(await ack(privateId)).toEqual([]);
    const removed = await message("Removed", f.group, { removed_at: new Date().toISOString() });
    expect(await status(removed)).toBeUndefined(); expect(await ack(removed)).toEqual([]);
    await f.db.from("conversation_members").delete().eq("conversation_id", f.group).eq("user_id", f.marco.userId);
    expect(await ack(id)).toEqual([]);
    await f.db.from("conversation_members").insert({ conversation_id: f.group, user_id: f.marco.userId });
  });
  it("clears only individually viewed messages and keeps other request threads unread", async () => {
    await clients.marco.rpc("mark_conversation_read", { p_conversation: f.group });
    const first = await message("First unread"); const second = await message("Second unread");
    await ack(second, "marco", false);
    expect((await clients.marco.rpc("unread_counts", {})).data?.find((c) => c.conversation_id === f.group)?.unread).toBe(2);
    await ack(second);
    expect((await clients.marco.rpc("unread_counts", {})).data?.find((c) => c.conversation_id === f.group)?.unread).toBe(1);
    await ack(first); expect((await clients.marco.rpc("unread_counts", {})).data?.find((c) => c.conversation_id === f.group)).toBeUndefined();
    const { data: threads } = await f.db.from("agent_threads").insert(["A", "B"].map((title) => ({ owner_id: f.luca.userId, conversation_id: f.myAgent, title }))).select("id");
    const ids = await Promise.all(threads!.map((t) => message(`Thread ${t.id}`, f.myAgent, { thread_id: t.id, sender_user_id: null, sender_agent_id: f.luca.agent.id, visible_to: f.luca.userId })));
    await ack(ids[1], "luca"); const summaries = await clients.luca.rpc("my_agent_threads", {});
    expect(summaries.error).toBeNull(); expect(summaries.data?.find((t) => t.id === threads![0].id)?.unread).toBe(1);
    expect(summaries.data?.find((t) => t.id === threads![1].id)?.unread).toBe(0);
  });
  it("distinguishes agent acceptance from an automated reply and actual human viewing of the matching question", async () => {
    const question = "Can you store four bicycles?"; const id = await message(question, f.direct);
    await message("An automatic answer", f.direct, { sender_user_id: null, sender_agent_id: f.business.agent.id });
    expect(await status(id)).toMatchObject({ kind: "agent", agent_received_at: null, owner_seen_at: null });
    await f.db.rpc("record_agent_receipt", { p_message: id, p_agent: f.marco.agent.id });
    expect((await status(id)).agent_received_at).toBeNull();
    const task = crypto.randomUUID();
    expect((await f.db.rpc("record_agent_receipt", { p_message: id, p_agent: f.business.agent.id, p_task: task })).error).toBeNull();
    expect((await status(id)).agent_received_at).toBeTruthy(); expect((await status(id)).owner_seen_at).toBeNull();
    const { data: exchange, error: exchangeError } = await f.db.from("task_exchanges").insert({ from_agent: f.luca.agent.id, to_agent: f.business.agent.id, skill: "answer_question", a2a_task_id: task }).select("id").single();
    expect(exchangeError).toBeNull();
    const { data: inbox, error: inboxError } = await f.db.from("inbox_items").insert({ owner_id: f.business.userId, agent_id: f.business.agent.id, from_agent: f.luca.agent.id, kind: "question", exchange_id: exchange!.id, payload: { business: true, question: "A different question" } }).select("id").single();
    expect(inboxError).toBeNull();
    await f.db.rpc("link_business_receipt", { p_inbox: inbox!.id });
    await clients.business.rpc("acknowledge_business_question", { p_inbox: inbox!.id }); expect((await status(id)).owner_seen_at).toBeNull();
    await f.db.from("inbox_items").update({ payload: { business: true, question } }).eq("id", inbox!.id);
    expect((await f.db.rpc("link_business_receipt", { p_inbox: inbox!.id })).error).toBeNull();
    expect((await clients.marco.rpc("acknowledge_business_question", { p_inbox: inbox!.id })).data).toBe(false);
    expect((await status(id)).owner_seen_at).toBeNull();
    expect((await clients.business.rpc("acknowledge_business_question", { p_inbox: inbox!.id })).error).toBeNull();
    expect((await status(id)).owner_seen_at).toBeTruthy();
    await clients.business.rpc("set_read_receipts", { p_enabled: false });
    expect(await status(id)).toMatchObject({ owner_seen_at: null, owner_seen_shared: false });
    await clients.business.rpc("acknowledge_business_question", { p_inbox: inbox!.id }); expect((await status(id)).owner_seen_at).toBeNull();
  });
});
