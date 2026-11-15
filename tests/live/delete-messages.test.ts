import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, dbUp, SUPABASE_URL } from "./env";
import { planBusinessFixture } from "../fixtures/plan-business";
import type { Database } from "@/lib/database.types";
import { createCommunity } from "@/lib/social/communities";
import { resolveReply } from "@/lib/social/quote-server";
import { forwardMessage, forwardable } from "@/lib/social/forward-server";
import { GET } from "@/app/api/chat-attachments/[id]/route";
import { MockProvider } from "@/lib/llm/mock";
import { setLLMProviderForTesting } from "@/lib/llm";
import { handleAgentCommand } from "@/lib/agents/in-chat";
import { handleOwnerMessage } from "@/lib/coordination/orchestrator";
import { withThread } from "@/lib/agents/thread-context";
import { communityTrust } from "@/lib/social/guard-server";

const session = vi.hoisted(() => ({ user: null as { id: string } | null, client: null as unknown }));
vi.mock("@/lib/auth", () => ({ getUser: async () => session.user }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));

describe.skipIf(!dbUp)("owner message deletion", () => {
  let f: Awaited<ReturnType<typeof planBusinessFixture>>; let dm: string; let channel: string; let community: string;
  const clients: Record<string, ReturnType<typeof createClient<Database>>> = {};
  const storagePaths: string[] = [];
  const provider = new MockProvider();
  beforeAll(async () => {
    f = await planBusinessFixture(); setLLMProviderForTesting(provider);
    for (const [key, person] of Object.entries({ luca: f.luca, marco: f.marco, business: f.business })) {
      const client = createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
      const { error } = await client.auth.signInWithPassword({ email: person.email, password: f.password }); if (error) throw error; clients[key] = client;
    }
    const made = await createCommunity({ userId: f.luca.userId, agent: f.luca.agent }, { name: "Delete tests", description: "Temporary community for testing safe message deletion", avatar: "🏟️", visibility: "private" });
    if (!made.ok) throw new Error(made.error); community = made.id;
    channel = (await f.db.from("conversations").select("id").eq("community_id", community).eq("channel", "general").single()).data!.id;
    dm = (await f.db.from("conversations").insert({ kind: "dm", created_by: f.luca.userId }).select("id").single()).data!.id;
    await f.db.from("conversation_members").insert([f.luca, f.marco].map((p) => ({ conversation_id: dm, user_id: p.userId })));
    await f.db.from("contacts").insert({ requester_agent: f.luca.agent.id, addressee_agent: f.marco.agent.id, status: "accepted" });
  });
  afterAll(async () => {
    setLLMProviderForTesting(undefined);
    if (f) {
      const { data: copied } = await f.db.from("chat_attachments").select("path").eq("uploader_id", f.luca.userId);
      const paths = [...new Set([...storagePaths, ...(copied ?? []).map((file) => file.path)])];
      if (paths.length) await f.db.storage.from("chat-attachments").remove(paths);
      await f.db.from("communities").delete().eq("id", community); await f.cleanup();
      if (paths.length) await f.db.from("chat_attachment_gc").delete().in("path", paths);
    }
  });
  function as(key: "luca" | "marco" | "business") { session.client = clients[key]; session.user = { id: f[key].userId }; }
  async function message(content: string, conversation = f.group, extra: Partial<Database["public"]["Tables"]["messages"]["Insert"]> = {}) {
    const { data, error } = await f.db.from("messages").insert({ conversation_id: conversation, sender_user_id: f.luca.userId, is_ai_generated: Boolean(extra.sender_agent_id), content, ...extra }).select("*").single();
    if (error) throw error; return data!;
  }
  async function remove(id: string, person = "luca") { const result = await clients[person].rpc("delete_own_message", { p_message: id }); expect(result.error).toBeNull(); return result.data; }
  const row = async (id: string) => (await f.db.from("messages").select("*").eq("id", id).single()).data!;
  const download = (id: string) => GET(new Request(`http://localhost:3000/api/chat-attachments/${id}`), { params: Promise.resolve({ id }) });

  it("deletes human messages in DMs, groups, communities, My Agent and business-agent chats using database timestamps", async () => {
    for (const conversation of [dm, f.group, channel, f.myAgent, f.direct]) {
      const original = await message("Delete this text", conversation, { metadata: { original: "Sensitive metadata" } });
      expect(await remove(original.id)).toBe(conversation);
      const deleted = await row(original.id);
      expect(deleted).toMatchObject({ content: "Deleted message", metadata: {}, sender_user_id: f.luca.userId, created_at: original.created_at, removed_by: f.luca.userId });
      expect(deleted.deleted_at).toBeTruthy(); expect(deleted.deleted_at).toBe(deleted.removed_at);
      await remove(original.id); expect((await row(original.id)).deleted_at).toBe(deleted.deleted_at);
    }
  });
  it("rejects anonymous users, other people, outsiders and agent-authored output, including your own agent", async () => {
    const id = (await message("Author only")).id;
    for (const person of ["marco", "business"]) expect((await clients[person].rpc("delete_own_message", { p_message: id })).error).toBeTruthy();
    const anon = createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } }); expect((await anon.rpc("delete_own_message", { p_message: id })).error).toBeTruthy();
    for (const agent of [f.luca.agent, f.business.agent]) {
      const output = await message("An agent answer", f.group, { sender_user_id: null, sender_agent_id: agent.id });
      expect((await clients.luca.rpc("delete_own_message", { p_message: output.id })).error).toBeTruthy();
    }
    expect((await clients.luca.from("messages").update({ deleted_at: new Date().toISOString() }).eq("id", id).select("id")).data).toEqual([]);
    expect((await row(id)).deleted_at).toBeNull();
  });
  it("requires current membership even for the author and keeps private commands private", async () => {
    const id = (await message("Member only", dm)).id;
    await f.db.from("conversation_members").delete().eq("conversation_id", dm).eq("user_id", f.luca.userId);
    expect((await clients.luca.rpc("delete_own_message", { p_message: id })).error).toBeTruthy();
    await f.db.from("conversation_members").insert({ conversation_id: dm, user_id: f.luca.userId });
    const privateMessage = await message("@agent private instruction", f.group, { visible_to: f.luca.userId });
    await remove(privateMessage.id);
    expect((await clients.marco.from("messages").select("*").eq("id", privateMessage.id)).data).toEqual([]);
    expect((await row(privateMessage.id)).visible_to).toBe(f.luca.userId);
  });
  it("invalidates quotes and forwarding, removes receipts, and cannot be restored by a delayed moderation write", async () => {
    as("luca"); const original = await message("Never revive this message");
    const reply = await message("A reply", f.group, { sender_user_id: f.marco.userId, reply_to: original.id });
    expect(await resolveReply(f.group, original.id, f.luca.userId)).toMatchObject({ text: original.content });
    await remove(original.id); expect(await resolveReply(f.group, original.id, f.luca.userId)).toBeNull(); expect(await forwardable(f.luca.userId, original.id)).toMatchObject({ ok: false });
    expect((await clients.luca.rpc("get_message_receipts", { p_ids: [original.id] })).data).toEqual([]);
    const restore = await f.db.from("messages").update({ removed_at: null, deleted_at: null, content: original.content, metadata: { kind: "proposal", task_id: f.taskId } }).eq("id", original.id);
    expect(restore.error).toBeNull(); expect(await row(original.id)).toMatchObject({ content: "Deleted message", metadata: {} });
    expect((await row(original.id)).deleted_at).toBeTruthy(); expect((await row(reply.id)).reply_to).toBe(original.id);
  });
  it("revokes attachments immediately while previously forwarded copies remain independent", async () => {
    as("luca"); const fileId = crypto.randomUUID(); const path = `${f.luca.userId}/${fileId}.txt`; storagePaths.push(path);
    expect((await f.db.storage.from("chat-attachments").upload(path, "Text document", { contentType: "text/plain" })).error).toBeNull();
    expect((await f.db.rpc("register_chat_attachment", { p_id: fileId, p_conversation: f.group, p_user: f.luca.userId, p_path: path, p_name: "notes.txt", p_mime: "text/plain", p_kind: "document", p_bytes: 13 })).error).toBeNull();
    const original = await message("A caption to delete", f.group, { metadata: { kind: "rich_message", attachment_ids: [fileId], shared_location: { lat: 56, lon: -3 } } });
    const forwarded = await forwardMessage(f.luca.userId, f.luca.agent, original.id, [`contact:${f.marco.agent.id}`]);
    expect(forwarded, JSON.stringify(forwarded)).toMatchObject({ results: [{ ok: true }] });
    const { data: copy } = await f.db.from("messages").select("id").eq("conversation_id", dm).eq("content", original.content).single();
    const { data: copiedFile } = await f.db.from("chat_attachments").select("id,path").eq("message_id", copy!.id).single();
    as("marco"); expect((await download(fileId)).status).toBe(200); await remove(original.id);
    expect((await download(fileId)).status).toBe(404); expect((await download(copiedFile!.id)).status).toBe(200);
    expect((await row(copy!.id)).content).toBe(original.content); expect((await row(original.id)).metadata).toEqual({});
    expect((await f.db.from("chat_attachment_gc").select("path").eq("path", path)).data).toEqual([{ path }]);
  });
  it("does not cancel existing polls, plans or staff requests and preserves native-poll idempotency", async () => {
    const nonce = crypto.randomUUID();
    const { data: id, error } = await f.db.rpc("create_chat_poll", { p_owner: f.luca.userId, p_agent: f.luca.agent.id, p_origin: f.group, p_group: f.group, p_thread: null, p_client: nonce, p_question: "Dinner?", p_options: ["Pizza", "Sushi"], p_voters: [f.luca.agent.handle, f.marco.agent.handle] }); expect(error).toBeNull();
    const meta = (await row(id!)).metadata as { step_id: string; task_id: string };
    const before = (await f.db.from("plan_steps").select("status,result").eq("id", meta.step_id).single()).data;
    const { data: inbox } = await f.db.from("inbox_items").insert({ owner_id: f.business.userId, agent_id: f.business.agent.id, from_agent: f.luca.agent.id, kind: "question", payload: { business: true, question: "An already submitted request" } }).select("id").single();
    await remove(id!);
    expect((await row(id!)).metadata).toEqual({ client_id: nonce });
    expect((await f.db.from("plan_steps").select("status,result").eq("id", meta.step_id).single()).data).toEqual(before);
    expect((await f.db.from("tasks").select("status").eq("id", f.taskId).single()).data?.status).toBe("completed");
    expect((await f.db.from("inbox_items").select("status").eq("id", inbox!.id).single()).data?.status).toBe("open");
  });
  it("excludes deleted messages from subsequent shared-chat and My Agent model context", async () => {
    const marker = "DELETED_SECRET_849382"; const first = await message(marker); await remove(first.id);
    const spy = vi.spyOn(provider, "generateText");
    await handleAgentCommand({ userId: f.luca.userId, agent: f.luca.agent, conversation: { id: f.group, kind: "group", title: "Test" }, text: "@agent summarise" });
    const sharedCall = spy.mock.calls.find(([req]) => req.purpose === "chat_assist"); expect(sharedCall).toBeDefined(); expect(JSON.stringify(sharedCall)).not.toContain(marker); expect(JSON.stringify(sharedCall)).not.toContain("Deleted message");
    const { data: thread } = await f.db.from("agent_threads").insert({ owner_id: f.luca.userId, conversation_id: f.myAgent, title: "Context checks" }).select("id").single();
    const second = await message(marker, f.myAgent, { thread_id: thread!.id }); await remove(second.id);
    await withThread({ conversationId: f.myAgent, threadId: thread!.id }, () => handleOwnerMessage({ userId: f.luca.userId, agent: f.luca.agent, conversationId: f.myAgent, text: "Help me write a friendly greeting" }));
    const ownerCall = spy.mock.calls.find(([req]) => req.purpose === "owner_chat"); expect(ownerCall).toBeDefined(); expect(JSON.stringify(ownerCall)).not.toContain(marker); expect(JSON.stringify(ownerCall)).not.toContain("Deleted message"); spy.mockRestore();
  });
  it("does not count owner deletion as a moderation penalty or let an author erase an existing penalty", async () => {
    await f.db.from("community_members").insert({ community_id: community, user_id: f.marco.userId, role: "member", joined_at: new Date(Date.now() - 30 * 86400000).toISOString() });
    await f.db.from("conversation_members").insert({ conversation_id: channel, user_id: f.marco.userId });
    const { data: history, error } = await f.db.from("messages").insert(Array.from({ length: 21 }, (_, i) => ({ conversation_id: channel, sender_user_id: f.marco.userId, is_ai_generated: false, content: `A contribution ${i}` }))).select("id"); expect(error).toBeNull();
    expect(await communityTrust(community, f.marco.userId)).toBe("trusted");
    await remove(history![0].id, "marco"); expect(await communityTrust(community, f.marco.userId)).toBe("trusted");
    const moderated = await message("A moderated contribution", channel, { sender_user_id: f.marco.userId });
    await f.db.from("messages").update({ removed_at: new Date().toISOString(), removed_by: f.luca.userId, content: "Removed by a moderator" }).eq("id", moderated.id);
    expect((await clients.marco.rpc("delete_own_message", { p_message: moderated.id })).error).toBeTruthy();
    expect((await row(moderated.id)).deleted_at).toBeNull(); expect(await communityTrust(community, f.marco.userId)).toBe("new");
  });
});
