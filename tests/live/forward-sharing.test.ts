import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { dbUp, ANON_KEY, SUPABASE_URL } from "./env";
import { planBusinessFixture } from "../fixtures/plan-business";
import { forwardable, forwardMessage } from "@/lib/social/forward-server";
import { postMessage } from "@/lib/data/chat";
import { GET } from "@/app/api/chat-attachments/[id]/route";
import { POST } from "@/app/api/chats/[id]/attachments/route";
import { pruneChatAttachments } from "@/lib/chat/files";
import { resolveReply } from "@/lib/social/quote-server";
import type { Database } from "@/lib/database.types";
import { createCommunity } from "@/lib/social/communities";

const session = vi.hoisted(() => ({ user: null as { id: string } | null, agent: null as unknown, client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));
vi.mock("@/lib/auth", () => ({ getUser: async () => session.user, requireAgent: async () => ({ user: session.user, agent: session.agent }) }));

describe.skipIf(!dbUp)("consistent quote/forward permissions and independent copies", () => {
  let f: Awaited<ReturnType<typeof planBusinessFixture>>; let destination: string;
  beforeAll(async () => {
    f = await planBusinessFixture();
    const { data } = await f.db.from("conversations").insert({ kind: "group", title: "Forward destination", created_by: f.luca.userId }).select("id").single(); destination = data!.id;
    // Paul is a human recipient outside the source group; business agents cannot be members.
    await f.db.from("conversation_members").delete().eq("conversation_id", f.group).eq("user_id", f.paul.userId);
    expect((await f.db.from("conversation_members").insert([f.luca, f.paul].map((person) => ({ conversation_id: destination, user_id: person.userId })))).error).toBeNull();
  });
  afterAll(async () => { if (f) await f.db.from("communities").delete().eq("owner_id", f.business.userId); await f?.cleanup(); await pruneChatAttachments(); });
  async function as(person: typeof f.luca) {
    const client = createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { error } = await client.auth.signInWithPassword({ email: person.email, password: f.password }); if (error) throw error;
    session.user = { id: person.userId }; session.agent = person.agent; session.client = client; return client;
  }
  const to = () => [`chat:${destination}`];
  async function copyOf(content: string) { return (await f.db.from("messages").select("*").eq("conversation_id", destination).eq("content", content).single()).data!; }
  async function upload(file: File) {
    const form = new FormData(); form.set("file", file);
    const response = await POST(new Request(`http://localhost:3000/api/chats/${f.group}/attachments`, { method: "POST", headers: { Origin: "http://localhost:3000" }, body: form }), { params: Promise.resolve({ id: f.group }) });
    expect(response.status).toBe(200); return (await response.json()).id as string;
  }
  const getFile = (id: string) => GET(new Request(`http://localhost:3000/api/chat-attachments/${id}`), { params: Promise.resolve({ id }) });

  it("blocks private, removed and inaccessible messages on the server", async () => {
    const privateMessage = await postMessage({ conversationId: f.group, from: "agent", agentId: f.luca.agent.id, visibleTo: f.luca.userId, content: "Private advice" });
    const removed = await postMessage({ conversationId: f.group, from: "human", userId: f.marco.userId, content: "Removed text" });
    await f.db.from("messages").update({ removed_at: new Date().toISOString() }).eq("id", removed.id);
    await as(f.luca);
    expect(await forwardable(f.luca.userId, privateMessage.id)).toMatchObject({ ok: false });
    expect(await forwardMessage(f.luca.userId, f.luca.agent, privateMessage.id, to())).toHaveProperty("error");
    expect(await forwardable(f.luca.userId, removed.id)).toMatchObject({ ok: false });
    expect(await resolveReply(f.group, privateMessage.id, f.luca.userId)).toBeNull(); expect(await resolveReply(f.group, removed.id, f.luca.userId)).toBeNull();
    await as(f.business); expect(await forwardable(f.business.userId, privateMessage.id)).toMatchObject({ ok: false });
  });

  it("quotes and forwards own/other humans and own/other agents, preserving authorship, time and sources", async () => {
    await as(f.luca);
    for (const [kind, person, conversation] of [["human", f.luca, f.group], ["human", f.marco, f.group], ["agent", f.luca, f.myAgent], ["agent", f.business, f.direct]] as const) {
      const content = `${kind} message from ${person.agent.handle}`;
      const message = await postMessage({ conversationId: conversation, from: kind, userId: person.userId, agentId: person.agent.id, content, metadata: { sources: [{ url: "https://example.com/source", title: "Source" }] } });
      expect(await resolveReply(conversation, message.id, f.luca.userId)).toMatchObject({ id: message.id, text: content });
      expect(await forwardMessage(f.luca.userId, f.luca.agent, message.id, to())).toMatchObject({ results: [{ ok: true }] });
      const copied = await copyOf(content); const meta = copied.metadata as Record<string, unknown>;
      expect(meta.forwarded).toMatchObject({ count: 1, origin_at: message.created_at, origin_ai: kind === "agent" });
      expect(meta.sources).toEqual([{ url: "https://example.com/source", title: "Source" }]);
      expect(copied.is_ai_generated).toBe(false); // The forward is a person's action; attribution identifies the original AI.
      expect(await forwardMessage(f.luca.userId, f.luca.agent, copied.id, [`chat:${f.group}`])).toMatchObject({ results: [{ ok: true }] });
      const { data: twice } = await f.db.from("messages").select("metadata").eq("conversation_id", f.group).eq("content", content).neq("id", message.id).limit(1).single();
      expect((twice!.metadata as { forwarded: unknown }).forwarded).toMatchObject({ ...(meta.forwarded as object), count: 2 });
    }
  });

  it("copies files and location into the destination, with no access to the source chat", async () => {
    await as(f.marco);
    const png = await sharp({ create: { width: 80, height: 60, channels: 3, background: "green" } }).png().toBuffer();
    const files = [await upload(new File([new Uint8Array(png)], "photo.png")), await upload(new File(["Notes to forward"], "notes.txt"))];
    const message = await postMessage({ conversationId: f.group, from: "human", userId: f.marco.userId, content: "Photos and notes", metadata: { kind: "rich_message", attachment_ids: files, shared_location: { lat: 56, lon: -3 } } });
    await as(f.luca);
    const preview = await forwardable(f.luca.userId, message.id); expect(preview).toMatchObject({ ok: true, preview: { files: [{ kind: "image" }, { kind: "document" }], location: { lat: 56, lon: -3 } } });
    expect(await forwardMessage(f.luca.userId, f.luca.agent, message.id, to())).toMatchObject({ results: [{ ok: true }] });
    const copy = await copyOf(message.content);
    const { data: copiedFiles } = await f.db.from("chat_attachments").select("id,path,uploader_id").eq("message_id", copy.id);
    expect(copiedFiles).toHaveLength(2); expect(copiedFiles!.every((file) => !files.includes(file.id) && file.uploader_id === f.luca.userId)).toBe(true);
    await as(f.paul);
    for (const id of files) expect((await getFile(id)).status).toBe(404);
    for (const file of copiedFiles!) expect((await getFile(file.id)).status).toBe(200);
    // Removing the source doesn't break an already-authorised, independent forward.
    await f.db.from("messages").update({ removed_at: new Date().toISOString() }).eq("id", message.id);
    for (const file of copiedFiles!) expect((await getFile(file.id)).status).toBe(200);
  });

  it("rolls back copies on quota failure and doesn't send a text-only substitute", async () => {
    await as(f.marco); const id = await upload(new File(["Quota test file"], "quota.txt"));
    const source = await postMessage({ conversationId: f.group, from: "human", userId: f.marco.userId, content: "Quota test", metadata: { kind: "rich_message", attachment_ids: [id] } });
    await f.db.from("chat_upload_usage").upsert({ user_id: f.luca.userId, day: new Date().toISOString().slice(0, 10), bytes: 104857600 });
    await as(f.luca); expect(await forwardMessage(f.luca.userId, f.luca.agent, source.id, to())).toMatchObject({ results: [{ ok: false }] });
    expect((await f.db.from("messages").select("id").eq("conversation_id", destination).eq("content", source.content)).data).toEqual([]);
    expect((await f.db.from("chat_attachments").select("id").eq("conversation_id", destination).is("message_id", null)).data).toEqual([]);
    await f.db.from("chat_upload_usage").delete().eq("user_id", f.luca.userId);
  });

  it("does not send changed content until it has been reviewed again", async () => {
    await as(f.luca);
    const message = await postMessage({ conversationId: f.group, from: "human", userId: f.marco.userId, content: "Original version" });
    const reviewed = await forwardable(f.luca.userId, message.id); expect(reviewed.ok).toBe(true); if (!reviewed.ok) return;
    await f.db.from("messages").update({ content: "Changed version" }).eq("id", message.id);
    expect(await forwardMessage(f.luca.userId, f.luca.agent, message.id, to(), reviewed.revision)).toHaveProperty("error");
    expect((await f.db.from("messages").select("id").eq("conversation_id", destination).eq("content", "Changed version")).data).toEqual([]);
  });

  it("sends poll, plan and approval cards as inert snapshots with no original task identifiers", async () => {
    await as(f.luca);
    const { data: poll } = await f.db.rpc("create_chat_poll", { p_owner: f.luca.userId, p_agent: f.luca.agent.id, p_origin: f.group, p_group: f.group, p_thread: null, p_client: crypto.randomUUID(), p_question: "Pizza or sushi?", p_options: ["Pizza", "Sushi"], p_voters: [f.luca.agent.handle, f.marco.agent.handle] });
    const { data: proposal } = await f.db.from("proposals").select("id").eq("task_id", f.taskId).single();
    const plan = await postMessage({ conversationId: f.group, from: "agent", agentId: f.luca.agent.id, content: "Shared dinner", metadata: { kind: "proposal", proposal_id: proposal!.id, task_id: f.taskId } });
    const approval = await postMessage({ conversationId: f.myAgent, from: "agent", agentId: f.luca.agent.id, content: "Approve this plan", metadata: { kind: "task_card", task_id: f.taskId } });
    for (const id of [poll!, plan.id, approval.id]) {
      expect(await forwardMessage(f.luca.userId, f.luca.agent, id, to())).toMatchObject({ results: [{ ok: true }] });
    }
    const { data: copies } = await f.db.from("messages").select("metadata,content").eq("conversation_id", destination).eq("metadata->>kind", "forwarded_snapshot");
    expect(copies).toHaveLength(3);
    for (const copied of copies!) { const meta = copied.metadata as Record<string, unknown>; expect(meta).not.toHaveProperty("task_id"); expect(meta).not.toHaveProperty("step_id"); expect(meta).not.toHaveProperty("proposal_id"); expect(meta).not.toHaveProperty("handoff_offer"); }
    expect(copies!.map((copy) => copy.content).join("\n")).toContain("Venue: Trattoria Sole");
    expect(copies!.map((copy) => copy.content).join("\n")).toContain("Sushi: 0 votes");
    expect((await f.db.from("tasks").select("status").eq("id", f.taskId).single()).data?.status).toBe("completed");
  });

  it("rechecks target membership and admin posting rules", async () => {
    await as(f.luca); const message = await postMessage({ conversationId: f.group, from: "human", userId: f.marco.userId, content: "Posting permissions" });
    await f.db.from("conversations").update({ only_admins_send: true }).eq("id", destination);
    expect(await forwardMessage(f.luca.userId, f.luca.agent, message.id, to())).toMatchObject({ results: [{ ok: false }] });
    await f.db.from("conversations").update({ only_admins_send: false }).eq("id", destination);
    await f.db.from("conversation_members").delete().eq("conversation_id", destination).eq("user_id", f.luca.userId);
    expect(await forwardMessage(f.luca.userId, f.luca.agent, message.id, to())).toMatchObject({ results: [{ ok: false }] });
  });

  it("preserves sign-up ownership and timestamps in read-only snapshots", async () => {
    // Restore membership after the preceding permission-revocation scenario.
    await f.db.from("conversation_members").insert({ conversation_id: destination, user_id: f.luca.userId }); await as(f.luca);
    const { data: step } = await f.db.from("plan_steps").insert({ task_id: f.taskId, position: 2, type: "assign", status: "waiting", config: { items: ["Drinks", "Cake"] } }).select("id").single();
    await f.db.from("item_claims").insert({ step_id: step!.id, agent_id: f.marco.agent.id, item: "Drinks" });
    const message = await postMessage({ conversationId: f.group, from: "agent", agentId: f.luca.agent.id, content: "Who's bringing what?", metadata: { kind: "assign", step_id: step!.id, task_id: f.taskId } });
    const result = await forwardable(f.luca.userId, message.id); expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.preview.text).toContain(`Drinks: Marco (@${f.marco.agent.handle})`); expect(result.preview.text).toContain("Cake: Available");
    expect(result.preview.text).toMatch(/\d{4}-\d{2}-\d{2}T/); expect(result.preview.snapshot?.label).toBe("Sign-up list");
  });

  it("does not bypass a community's no-media rule by forwarding an attachment", async () => {
    const community = await createCommunity({ userId: f.business.userId, agent: f.business.agent }, { name: `No media ${f.luca.agent.handle}`, description: "Temporary text discussion community.", avatar: "📚", visibility: "private", houseRules: ["no_media"] });
    expect(community.ok).toBe(true); if (!community.ok) return;
    const { data: channel } = await f.db.from("conversations").select("id").eq("community_id", community.id).eq("channel", "general").single();
    await f.db.from("community_members").insert({ community_id: community.id, user_id: f.marco.userId, role: "member" }); await f.db.from("conversation_members").insert({ conversation_id: channel!.id, user_id: f.marco.userId });
    await as(f.luca); const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: "blue" } }).png().toBuffer(); const id = await upload(new File([new Uint8Array(png)], "restricted.png"));
    const message = await postMessage({ conversationId: f.group, from: "human", userId: f.luca.userId, content: "No-media forward", metadata: { kind: "rich_message", attachment_ids: [id] } });
    await as(f.marco); expect(await forwardMessage(f.marco.userId, f.marco.agent, message.id, [`chat:${channel!.id}`])).toMatchObject({ results: [{ ok: false, error: "This community doesn't allow images or videos." }] });
    expect((await f.db.from("chat_attachments").select("id").eq("conversation_id", channel!.id)).data).toEqual([]);
  });

  it("forwards attachments to an accepted contact's direct chat", async () => {
    await f.db.from("contacts").insert({ requester_agent: f.luca.agent.id, addressee_agent: f.paul.agent.id, status: "accepted" });
    await as(f.marco); const attachment = await upload(new File(["For Paul"], "for-paul.txt"));
    const original = await postMessage({ conversationId: f.group, from: "human", userId: f.marco.userId, content: "Direct forward", metadata: { kind: "rich_message", attachment_ids: [attachment] } });
    await as(f.luca); const result = await forwardMessage(f.luca.userId, f.luca.agent, original.id, [`contact:${f.paul.agent.id}`]);
    expect(result).toMatchObject({ results: [{ ok: true }] }); if ("error" in result) return;
    const conversation = result.results[0].conversationId!;
    expect((await f.db.from("conversations").select("kind").eq("id", conversation).single()).data?.kind).toBe("dm");
    const { data: message } = await f.db.from("messages").select("id").eq("conversation_id", conversation).eq("content", original.content).single();
    const { data: copy } = await f.db.from("chat_attachments").select("id").eq("message_id", message!.id).single();
    await as(f.paul); expect((await getFile(copy!.id)).status).toBe(200);
    await as(f.business); expect((await getFile(copy!.id)).status).toBe(404);
  });
});
