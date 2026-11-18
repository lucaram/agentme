import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { dbUp, SUPABASE_URL, ANON_KEY } from "./env";
import { planBusinessFixture } from "../fixtures/plan-business";
import { POST, DELETE } from "@/app/api/chats/[id]/attachments/route";
import { GET } from "@/app/api/chat-attachments/[id]/route";
import { sendRichMessage } from "@/lib/chat/send-rich";
import { getConversation } from "@/lib/data/chat";
import { chatWriteAccess } from "@/lib/chat/access";
import { ATTACHMENT_BUCKET, pruneChatAttachments } from "@/lib/chat/files";
import type { Database } from "@/lib/database.types";
import { createCommunity } from "@/lib/social/communities";
import { agentFilesFrom } from "@/lib/agents/files";
import { handleOwnerMessage } from "@/lib/coordination/orchestrator";
import { withThread } from "@/lib/agents/thread-context";
type AuthClient = ReturnType<typeof createClient<Database>>;

const session = vi.hoisted(() => ({ user: null as { id: string } | null, agent: null as unknown, client: null as unknown }));
vi.mock("@/lib/auth", () => ({ getUser: async () => session.user, requireAgent: async () => ({ user: session.user, agent: session.agent }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));

describe.skipIf(!dbUp)("private rich chat messages", () => {
  let f: Awaited<ReturnType<typeof planBusinessFixture>>;
  let image: Buffer;
  let fileId: string;
  let messageId: string;
  beforeAll(async () => { f = await planBusinessFixture(); image = await sharp({ create: { width: 80, height: 60, channels: 3, background: "green" } }).png().toBuffer(); });
  afterAll(async () => { if (f) await f.db.from("communities").delete().eq("owner_id", f.luca.userId); await f?.cleanup(); await pruneChatAttachments(); });
  async function as(person: typeof f.luca | null) {
    const client = createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    if (person) { const { error } = await client.auth.signInWithPassword({ email: person.email, password: f.password }); if (error) throw error; }
    session.user = person ? { id: person.userId } : null; session.agent = person?.agent; session.client = client;
    return client;
  }
  function upload(conversation = f.group, origin = "http://localhost:3000", name = "photo.png", body: Uint8Array | string = new Uint8Array(image)) {
    const form = new FormData(); form.set("file", new File([typeof body === "string" ? body : new Uint8Array(body)], name));
    return POST(new Request(`http://localhost:3000/api/chats/${conversation}/attachments`, { method: "POST", headers: { Origin: origin }, body: form }), { params: Promise.resolve({ id: conversation }) });
  }
  const download = () => GET(new Request(`http://localhost:3000/api/chat-attachments/${fileId}`), { params: Promise.resolve({ id: fileId }) });
  async function send(raw: unknown, convId = f.group) { return sendRichMessage({ conv: (await getConversation(convId))!, userId: f.luca.userId, agent: f.luca.agent, text: "Photo from our chat", raw }); }

  it("rejects anonymous, cross-origin and outsider uploads; closed posting rules still apply", async () => {
    await as(null); expect((await upload()).status).toBe(401);
    await as(f.luca); expect((await upload(f.group, "https://evil.example")).status).toBe(403);
    await as(f.business); expect((await upload()).status).toBe(400);
    await expect(chatWriteAccess(f.group, f.business.userId, f.business.agent.id)).rejects.toThrow();
    await f.db.from("conversations").update({ only_admins_send: true }).eq("id", f.group);
    await as(f.marco); expect((await upload()).status).toBe(400);
    await f.db.from("conversations").update({ only_admins_send: false }).eq("id", f.group);
  });
  it("uploads privately, binds exactly once to an authorised message and never exposes storage paths", async () => {
    const client = await as(f.luca);
    const response = await upload(); expect(response.status).toBe(200);
    const file = await response.json(); fileId = file.id;
    expect(file).toMatchObject({ kind: "image", mime: "image/webp" });
    expect(file).not.toHaveProperty("path");
    expect((await download()).status).toBe(404); // Unsent drafts are never downloadable.
    const nonce = crypto.randomUUID(); const raw = { clientId: nonce, attachments: [fileId] };
    expect(await send(raw)).not.toHaveProperty("error"); expect(await send(raw)).not.toHaveProperty("error");
    const { data: row } = await f.db.from("chat_attachments").select("message_id,path").eq("id", fileId).single(); messageId = row!.message_id!;
    expect((await client.from("chat_attachments").select("path").eq("id", fileId)).error).toBeTruthy();
    expect((await client.storage.from(ATTACHMENT_BUCKET).download(row!.path)).error).toBeTruthy();
    expect((await f.db.from("messages").select("id").eq("metadata->>client_id", nonce)).data).toHaveLength(1);
    expect(await send({ clientId: crypto.randomUUID(), attachments: [fileId] })).toHaveProperty("error");
    const downloaded = await download(); expect(downloaded.status).toBe(200); expect(downloaded.headers.get("content-type")).toBe("image/webp"); expect(downloaded.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("checks current chat membership for every download, including membership revoked after posting", async () => {
    await as(f.marco); expect((await download()).status).toBe(200);
    await f.db.from("conversation_members").delete().eq("conversation_id", f.group).eq("user_id", f.marco.userId);
    expect((await download()).status).toBe(404);
    await f.db.from("conversation_members").insert({ conversation_id: f.group, user_id: f.marco.userId });
    await as(f.business); expect((await download()).status).toBe(404);
    await as(null); expect((await download()).status).toBe(401);
  });
  it("rejects spoofed files and enforces daily quotas independently of deleted messages", async () => {
    await as(f.luca); expect((await upload(f.group, undefined, "fake.pdf", "MZ fake executable")).status).toBe(400);
    const day = new Date().toISOString().slice(0, 10);
    await f.db.from("chat_upload_usage").upsert({ user_id: f.luca.userId, day, bytes: 104857600 });
    const quota = await upload(); expect(quota.status).toBe(400); expect((await quota.json()).error).toMatch(/limit/i);
    await f.db.from("chat_upload_usage").delete().eq("user_id", f.luca.userId);
  });
  it("prevents attaching another conversation's draft and permits discarding one's own pending upload", async () => {
    await as(f.luca); const other = await (await upload(f.myAgent)).json();
    expect(await send({ clientId: crypto.randomUUID(), attachments: [other.id] })).toHaveProperty("error");
    await as(f.marco); await DELETE(new Request(`http://localhost:3000/api/chats/${f.myAgent}/attachments?file=${other.id}`, { method: "DELETE", headers: { Origin: "http://localhost:3000" } }), { params: Promise.resolve({ id: f.myAgent }) });
    expect((await f.db.from("chat_attachments").select("id").eq("id", other.id)).data).toHaveLength(1);
    await as(f.luca); await DELETE(new Request(`http://localhost:3000/api/chats/${f.myAgent}/attachments?file=${other.id}`, { method: "DELETE", headers: { Origin: "http://localhost:3000" } }), { params: Promise.resolve({ id: f.myAgent }) });
    expect((await f.db.from("chat_attachments").select("id").eq("id", other.id)).data).toEqual([]);
  });
  it("revokes attachment access on message removal and queues object cleanup", async () => {
    await as(f.luca); await f.db.from("messages").update({ removed_at: new Date().toISOString() }).eq("id", messageId);
    expect((await download()).status).toBe(404);
    expect((await f.db.from("chat_attachments").select("id").eq("id", fileId)).data).toEqual([]);
  });
  it("creates direct polls atomically and prevents duplicates", async () => {
    await f.db.from("agents").update({ group_add_policy: "contacts" }).eq("id", f.marco.agent.id);
    const nonce = crypto.randomUUID(); const raw = { clientId: nonce, poll: { question: "Pizza or sushi?", options: ["Pizza", "Sushi"] } };
    expect(await send(raw)).not.toHaveProperty("error"); expect(await send(raw)).not.toHaveProperty("error");
    const { data: rows } = await f.db.from("messages").select("id,metadata").eq("metadata->>client_id", nonce); expect(rows).toHaveLength(1);
    const { error: forbidden } = await (session.client as AuthClient).rpc("create_chat_poll", { p_owner: f.luca.userId, p_agent: f.luca.agent.id, p_origin: f.group, p_group: f.group, p_thread: null, p_client: crypto.randomUUID(), p_question: "Not permitted", p_options: ["Yes", "No"], p_voters: [f.luca.agent.handle] }); expect(forbidden?.code).toBe("42501");
  });
  it("takes only text where an agent is the reader: My Agent, a business's agent, and @agent in a chat", async () => {
    const textOnly = { error: "Your agent reads text only. Nothing has been sent." };
    expect(await send({ clientId: crypto.randomUUID(), poll: { question: "Friday dinner?", options: ["Yes", "No"], people: [f.marco.agent.id] } }, f.myAgent)).toEqual(textOnly);
    expect(await send({ clientId: crypto.randomUUID(), location: { lat: 51.5, lon: -0.12 } }, f.myAgent)).toEqual(textOnly);
    // (My Agent's files go through sendMessage to your own agent: see the next test.)
    expect(await send({ clientId: crypto.randomUUID(), location: { lat: 51.5, lon: -0.12 } }, f.direct)).toEqual(textOnly);
    const toAgent = await sendRichMessage({ conv: (await getConversation(f.group))!, userId: f.luca.userId, agent: f.luca.agent, text: "@agent where is this?", raw: { clientId: crypto.randomUUID(), location: { lat: 51.5, lon: -0.12 } } });
    expect(toAgent.error).toMatch(/^@agent reads text only/);
    // Nothing was posted by any of them.
    const { count } = await f.db.from("messages").select("id", { count: "exact", head: true }).in("conversation_id", [f.myAgent, f.direct]).eq("metadata->>kind", "rich_message");
    expect(count).toBe(0);
  });
  it("My Agent reads photos, PDFs and text files for its owner, keeps notes, and never takes voice or video", async () => {
    await as(f.luca);
    const pdf = (pages: number) => `%PDF-1.4\n1 0 obj<</Type /Catalog /Pages 2 0 R>>endobj\n2 0 obj<</Type /Pages /Count ${pages}>>endobj\n${Array.from({ length: pages }, (_, i) => `${i + 3} 0 obj<</Type /Page /Parent 2 0 R>>endobj`).join("\n")}\ntrailer<</Root 1 0 R>>\n%%EOF`;
    // Uploads: what your agent can read; never to a business's agent.
    const flyer = await upload(f.myAgent, undefined, "flyer.pdf", pdf(2)); expect(flyer.status).toBe(200);
    const sign = await upload(f.myAgent, undefined, "sign.png"); expect(sign.status).toBe(200);
    const long = await upload(f.myAgent, undefined, "long.pdf", pdf(21)); expect(long.status).toBe(400);
    expect((await long.json()).error).toBe("long.pdf has more than 20 pages. Attach the pages you need.");
    const wav = Buffer.alloc(44 + 1600); wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(1600, 40);
    const voice = await upload(f.myAgent, undefined, "voice.wav", new Uint8Array(wav)); expect(voice.status).toBe(400);
    expect((await voice.json()).error).toMatch(/^Your agent reads photos, PDFs, Word, Excel, PowerPoint and text files/);
    const toBusiness = await upload(f.direct, undefined, "flyer.pdf", pdf(1)); expect(toBusiness.status).toBe(400);
    expect((await toBusiness.json()).error).toBe("A business's agent reads text only.");
    // Only files: no location or poll for your agent; only your own unsent uploads.
    const ids = [(await flyer.json()).id, (await sign.json()).id];
    expect(await agentFilesFrom(f.myAgent, f.luca.userId, { clientId: crypto.randomUUID(), attachments: ids, location: { lat: 51.5, lon: -0.12 } })).toHaveProperty("error");
    expect(await agentFilesFrom(f.myAgent, f.marco.userId, { clientId: crypto.randomUUID(), attachments: ids })).toHaveProperty("error");
    const loaded = await agentFilesFrom(f.myAgent, f.luca.userId, { clientId: crypto.randomUUID(), attachments: ids });
    if ("error" in loaded) throw new Error(loaded.error);
    expect(loaded.files.map((file) => file.name).sort()).toEqual(["flyer.pdf", "sign.webp"]);
    // Your agent reads them once (notes kept with each file) and answers from them, in this topic.
    const { data: thread } = await f.db.from("agent_threads").insert({ owner_id: f.luca.userId, conversation_id: f.myAgent, title: "Files" }).select("id").single();
    await withThread({ conversationId: f.myAgent, threadId: thread!.id }, () => handleOwnerMessage({ userId: f.luca.userId, agent: f.luca.agent, conversationId: f.myAgent, text: "What are these?", files: { clientId: loaded.clientId, items: loaded.files } }));
    const { data: sent } = await f.db.from("messages").select("id").eq("conversation_id", f.myAgent).eq("metadata->>client_id", loaded.clientId).single();
    const { data: notes } = await f.db.from("chat_attachments").select("name,message_id,agent_notes").in("id", ids).order("name");
    expect(notes).toEqual([
      { name: "flyer.pdf", message_id: sent!.id, agent_notes: "Flyer: Jazz night, Friday 21 November, 8pm, at the Blue Room. Tickets £10." },
      { name: "sign.webp", message_id: sent!.id, agent_notes: "A road sign: no entry for vehicles over 7.5 tonnes." },
    ]);
    const lastReply = async () => (await f.db.from("messages").select("content").eq("conversation_id", f.myAgent).eq("thread_id", thread!.id).not("sender_agent_id", "is", null).order("created_at", { ascending: false }).limit(1).single()).data!.content;
    expect(await lastReply()).toContain("From flyer.pdf: Flyer: Jazz night");
    // A later question in the same topic: answered from the notes, without the file.
    await withThread({ conversationId: f.myAgent, threadId: thread!.id }, () => handleOwnerMessage({ userId: f.luca.userId, agent: f.luca.agent, conversationId: f.myAgent, text: "How much are the tickets?" }));
    expect(await lastReply()).toContain("Tickets £10");
    // Documents are read as text (Word, Excel, PowerPoint, OpenDocument, RTF, CSV): no AI needed to read them.
    const csv = await upload(f.myAgent, undefined, "prices.csv", "item,price\npizza,9\n"); expect(csv.status).toBe(200);
    const sheet = await agentFilesFrom(f.myAgent, f.luca.userId, { clientId: crypto.randomUUID(), attachments: [(await csv.json()).id] });
    if ("error" in sheet) throw new Error(sheet.error);
    expect(sheet.files[0]).toMatchObject({ name: "prices.csv", mime: "text/csv", text: "item,price\npizza,9" });
    await withThread({ conversationId: f.myAgent, threadId: thread!.id }, () => handleOwnerMessage({ userId: f.luca.userId, agent: f.luca.agent, conversationId: f.myAgent, text: "What does pizza cost?", files: { clientId: sheet.clientId, items: sheet.files } }));
    expect(await lastReply()).toContain("From prices.csv: item,price\npizza,9");
    // Clients can't read the private notes.
    const { error: hidden } = await (session.client as AuthClient).from("chat_attachments").select("agent_notes").in("id", ids);
    expect(hidden).not.toBeNull();
  });
  it("does not let attachments bypass a community's no-media house rule", async () => {
    const made = await createCommunity({ userId: f.luca.userId, agent: f.luca.agent }, { name: `Text discussion ${f.luca.agent.handle}`, description: "A temporary community for text discussion only.", avatar: "📚", visibility: "private", houseRules: ["no_media"] });
    expect(made).toMatchObject({ ok: true }); if (!made.ok) return;
    const { data: channel } = await f.db.from("conversations").select("id").eq("community_id", made.id).eq("channel", "general").single();
    await f.db.from("community_members").insert({ community_id: made.id, user_id: f.marco.userId, role: "member" });
    await f.db.from("conversation_members").insert({ conversation_id: channel!.id, user_id: f.marco.userId });
    await as(f.marco); const file = await (await upload(channel!.id)).json(); expect(file.id).toBeTruthy();
    const answer = await sendRichMessage({ conv: (await getConversation(channel!.id))!, userId: f.marco.userId, agent: f.marco.agent, text: "Just a photo", raw: { clientId: crypto.randomUUID(), attachments: [file.id] } });
    expect(answer.error).toMatch(/doesn't allow images or videos/);
    expect((await f.db.from("chat_attachments").select("message_id").eq("id", file.id).single()).data?.message_id).toBeNull();
  });
  it("preserves a typed caption and quoted message when creating a direct poll", async () => {
    const { data: quoted } = await f.db.from("messages").insert({ conversation_id: f.group, sender_user_id: f.marco.userId, is_ai_generated: false, content: "What should we eat?" }).select("id").single();
    const nonce = crypto.randomUUID();
    const answer = await sendRichMessage({ conv: (await getConversation(f.group))!, userId: f.luca.userId, agent: f.luca.agent, text: "Let's decide together", replyTo: quoted!.id, raw: { clientId: nonce, poll: { question: "Dinner?", options: ["Pizza", "Sushi"] } } });
    expect(answer).not.toHaveProperty("error");
    const { data: sent } = await f.db.from("messages").select("content,reply_to").eq("metadata->>client_id", nonce).single();
    expect(sent).toEqual({ content: "Let's decide together", reply_to: quoted!.id });
  });
});
