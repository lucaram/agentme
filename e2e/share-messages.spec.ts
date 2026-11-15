import { expect, test, type BrowserContext } from "@playwright/test";
import { config } from "dotenv";
import sharp from "sharp";
import { planBusinessFixture } from "../tests/fixtures/plan-business";
import type { Json } from "../lib/database.types";

config({ path: ".env.local", quiet: true });

test("quote and reviewed forwarding work for all authors, rich media and read-only cards", async ({ browser }) => {
  test.setTimeout(240000);
  const f = await planBusinessFixture(); const sessions: BrowserContext[] = [];
  async function login(email: string) {
    const context = await browser.newContext({ permissions: ["camera", "microphone"], timezoneId: "America/New_York" }); sessions.push(context); const page = await context.newPage(); await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(f.password); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(/\/chats/); return page;
  }
  async function add(conversation: string, content: string, actor: "luca" | "marco" | "my_agent" | "business", metadata: NonNullable<Json> = {}, visibleTo?: string, threadId?: string) {
    const agent = actor === "my_agent" ? f.luca.agent.id : actor === "business" ? f.business.agent.id : null;
    const { data, error } = await f.db.from("messages").insert({ conversation_id: conversation, content, sender_user_id: agent ? null : actor === "marco" ? f.marco.userId : f.luca.userId, sender_agent_id: agent, is_ai_generated: Boolean(agent), metadata, visible_to: visibleTo ?? null, thread_id: threadId ?? null, created_at: "2026-11-14T09:05:00.000Z" }).select("id").single();
    if (error) throw error; return data!.id;
  }
  try {
    const { data: target } = await f.db.from("conversations").insert({ kind: "group", title: "Shared copies", created_by: f.luca.userId }).select("id").single();
    const destination = target!.id;
    await f.db.from("conversation_members").insert([f.luca, f.business].map((person) => ({ conversation_id: destination, user_id: person.userId })));
    const { data: thread } = await f.db.from("agent_threads").insert({ owner_id: f.luca.userId, conversation_id: f.myAgent, title: "Share checks" }).select("id").single();
    const mine = await add(f.group, "My public message", "luca"); const marco = await add(f.group, "Marco's public message", "marco");
    const ownAgent = await add(f.myAgent, "A shareable answer from my agent", "my_agent", { kind: "info", sources: [{ url: "https://example.com/reference", title: "Reference" }] }, undefined, thread!.id);
    const business = await add(f.direct, "A shareable business answer", "business");
    const privateId = await add(f.group, "Private advice only for Luca", "my_agent", { kind: "agent_reply" }, f.luca.userId);
    const removed = await add(f.group, "Removed message", "marco"); await f.db.from("messages").update({ removed_at: new Date().toISOString() }).eq("id", removed);
    const page = await login(f.luca.email);
    for (const [path, id] of [[`/chats/${f.group}`, mine], [`/chats/${f.group}`, marco], [`/chats/${f.myAgent}?t=${thread!.id}`, ownAgent], [`/chats/${f.direct}`, business]]) {
      await page.goto(path); const row = page.locator(`#m-${id}`); await row.hover();
      await expect(row.getByTestId("message-timestamp")).toHaveText("14 Nov, 04:05");
      await expect(row.getByTestId("message-timestamp").locator("time")).toHaveAttribute("datetime", /2026-11-14T09:05:00/);
      await expect(row.getByRole("button", { name: "Reply", exact: true })).toBeVisible(); await expect(row.getByRole("button", { name: "Forward", exact: true })).toBeVisible();
      await row.getByRole("button", { name: "Reply", exact: true }).click(); await expect(page.getByTestId("replying-to")).toBeVisible(); await page.getByRole("button", { name: "Cancel reply", exact: true }).click();
    }
    await page.goto(`/chats/${f.group}`);
    for (const id of [privateId, removed]) { const row = page.locator(`#m-${id}`); await expect(row.getByTestId("message-timestamp")).toHaveText("14 Nov, 04:05"); await expect(row.getByRole("button", { name: "Reply", exact: true })).toHaveCount(0); await expect(row.getByRole("button", { name: "Forward", exact: true })).toHaveCount(0); }
    await page.locator(`#m-${marco}`).getByRole("button", { name: "Reply", exact: true }).click(); await page.getByRole("textbox", { name: "Message", exact: true }).fill("A reply quoting Marco"); await page.getByRole("button", { name: "Send", exact: true }).click(); await expect(page.getByTestId("quote")).toContainText("Marco's public message");

    async function forward(path: string, id: string, previewText: string, checkCancellation = false) {
      await page.goto(path); await page.locator(`#m-${id}`).getByRole("button", { name: "Forward", exact: true }).click();
      let dialog = page.getByRole("dialog", { name: "Forward", exact: true }); await expect(dialog.getByTestId("forward-preview")).toContainText(previewText);
      const before = (await f.db.from("messages").select("id").eq("conversation_id", destination)).data!.length;
      await dialog.getByRole("checkbox", { name: "Shared copies", exact: true }).check();
      expect((await f.db.from("messages").select("id").eq("conversation_id", destination)).data).toHaveLength(before);
      if (checkCancellation) { await dialog.getByRole("button", { name: "Close", exact: true }).click(); await page.locator(`#m-${id}`).getByRole("button", { name: "Forward", exact: true }).click(); dialog = page.getByRole("dialog", { name: "Forward", exact: true }); await dialog.getByRole("checkbox", { name: "Shared copies", exact: true }).check(); }
      await dialog.getByRole("button", { name: /Forward to 1 chat/ }).click(); await expect(dialog.getByTestId("forward-results")).toContainText("Sent to Shared copies"); await dialog.getByRole("button", { name: "Done", exact: true }).click();
      const { data: copied } = await f.db.from("messages").select("id,content,metadata").eq("conversation_id", destination).order("created_at", { ascending: false }).limit(1).single(); return copied!;
    }
    const agentCopy = await forward(`/chats/${f.myAgent}?t=${thread!.id}`, ownAgent, "A shareable answer from my agent", true);
    await page.goto(`/chats/${destination}`); const agentRow = page.locator(`#m-${agentCopy.id}`); await expect(agentRow.getByTestId("forwarded-label")).toContainText(`@${f.luca.agent.handle}'s agent`); await expect(agentRow.getByTestId("forward-origin")).toBeVisible(); await expect(agentRow.getByTestId("sources").getByRole("link", { name: /Reference/ })).toHaveAttribute("href", "https://example.com/reference");
    await agentRow.getByRole("button", { name: "Reply", exact: true }).click(); await page.getByRole("textbox", { name: "Message", exact: true }).fill("Reply to forwarded AI"); await page.getByRole("button", { name: "Send", exact: true }).click(); await expect(page.getByTestId("quote")).toContainText("forwarded from"); await expect(page.getByTestId("quote").getByText("AI", { exact: true })).toBeVisible();

    const { data: pollId } = await f.db.rpc("create_chat_poll", { p_owner: f.luca.userId, p_agent: f.luca.agent.id, p_origin: f.group, p_group: f.group, p_thread: null, p_client: crypto.randomUUID(), p_question: "Pizza or sushi?", p_options: ["Pizza", "Sushi"], p_voters: [f.luca.agent.handle, f.marco.agent.handle] });
    const { data: proposal } = await f.db.from("proposals").select("id").eq("task_id", f.taskId).single();
    const plan = await add(f.group, "Dinner plan to share", "my_agent", { kind: "proposal", proposal_id: proposal!.id, task_id: f.taskId });
    await f.db.from("tasks").update({ status: "awaiting_approval" }).eq("id", f.taskId);
    const approval = await add(f.myAgent, "Approval card to share", "my_agent", { kind: "task_card", task_id: f.taskId }, undefined, thread!.id);
    for (const [path, id, text] of [[`/chats/${f.group}`, pollId!, "Sushi: 0 votes"], [`/chats/${f.group}`, plan, "Venue: Trattoria Sole"], [`/chats/${f.myAgent}?t=${thread!.id}`, approval, "Saturday Italian Dinner"]]) {
      const copied = await forward(path, id, text); await page.goto(`/chats/${destination}`); const row = page.locator(`#m-${copied.id}`); await expect(row.getByTestId("shared-snapshot")).toContainText("Read-only copy"); await expect(row.getByTestId("poll")).toHaveCount(0); await expect(row.getByTestId("proposal")).toHaveCount(0); await expect(row.getByTestId("task-card")).toHaveCount(0); await expect(row.getByRole("button", { name: "Reply", exact: true })).toBeVisible();
    }
    expect((await f.db.from("tasks").select("status").eq("id", f.taskId).single()).data?.status).toBe("awaiting_approval");

    // Media previews and forwarding preserve photo, file, audio, video and caption in one copy.
    await page.goto(`/chats/${f.group}`);
    const photo = await sharp({ create: { width: 160, height: 120, channels: 3, background: "green" } }).png().toBuffer();
    const wav = Buffer.alloc(44 + 16000); wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(16000, 40);
    await page.getByLabel("Choose attachments", { exact: true }).setInputFiles([{ name: "photo.png", mimeType: "image/png", buffer: photo }, { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Forwarded notes") }, { name: "voice.wav", mimeType: "audio/wav", buffer: wav }]);
    await expect(page.getByTestId("attachment-card")).toHaveCount(3); await page.getByRole("button", { name: "Attach", exact: true }).click(); await page.getByRole("button", { name: /Camera/ }).click();
    const camera = page.getByRole("dialog", { name: "Camera", exact: true }); await camera.getByRole("button", { name: "Record video", exact: true }).click(); await expect(camera.getByRole("status")).toContainText("0:01"); await camera.getByRole("button", { name: "Stop & review", exact: true }).click(); await expect(page.getByTestId("attachment-card")).toHaveCount(4);
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("Travel notes and media"); await page.getByRole("button", { name: "Send", exact: true }).click(); await expect(page.getByTestId("attachment-preview")).toHaveCount(0);
    const { data: rich } = await f.db.from("messages").select("id").eq("conversation_id", f.group).eq("content", "Travel notes and media").single();
    const copied = await forward(`/chats/${f.group}`, rich!.id, "Travel notes and media");
    await page.goto(`/chats/${destination}`); const richRow = page.locator(`#m-${copied.id}`); await expect(richRow.getByRole("img")).toHaveCount(1); await expect(richRow.locator("video")).toHaveCount(1); await expect(richRow.getByTestId("voice-message")).toBeVisible(); await expect(richRow.getByTestId("attachment-caption")).toHaveText("Travel notes and media");
    const documentUrl = await richRow.getByRole("link", { name: /notes.txt/ }).getAttribute("href");
    const receiver = await login(f.business.email); await receiver.goto(`/chats/${destination}`); expect((await receiver.request.get(documentUrl!)).status()).toBe(200); await receiver.goto(`/chats/${f.group}`); await expect(receiver.getByRole("heading", { name: "404", exact: true })).toBeVisible();
    await f.db.from("messages").update({ removed_at: new Date().toISOString() }).eq("id", rich!.id); expect((await receiver.request.get(documentUrl!)).status()).toBe(200);
  } finally {
    for (const session of sessions) await session.close();
    const { data: objects } = await f.db.storage.from("chat-attachments").list(f.luca.userId, { limit: 1000 }); const paths = (objects ?? []).map((object) => `${f.luca.userId}/${object.name}`);
    const removed = paths.length ? await f.db.storage.from("chat-attachments").remove(paths) : { error: null }; await f.cleanup(); if (!removed.error) await f.db.from("chat_attachment_gc").delete().like("path", `${f.luca.userId}/%`);
  }
});
