import { expect, test, type BrowserContext } from "@playwright/test";
import { config } from "dotenv";
import sharp from "sharp";
import { planBusinessFixture } from "../tests/fixtures/plan-business";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";

config({ path: ".env.local", quiet: true });

test("owner deletion confirms, updates everyone live and invalidates quotes without exposing private commands", async ({ browser }) => {
  const f = await planBusinessFixture(); const sessions: BrowserContext[] = [];
  async function login(email: string) {
    const context = await browser.newContext(); sessions.push(context); const page = await context.newPage(); await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(f.password); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(/\/chats/); return page;
  }
  async function add(content: string, extra: Partial<Database["public"]["Tables"]["messages"]["Insert"]> = {}) {
    const { data, error } = await f.db.from("messages").insert({ conversation_id: f.group, sender_user_id: f.luca.userId, is_ai_generated: false, content, ...extra }).select("id").single(); if (error) throw error; return data!.id;
  }
  try {
    const source = await add("The pitch is booked for 7pm", { created_at: "2026-11-14T09:05:00Z" });
    const reply = await add("I'll bring the ball", { sender_user_id: f.marco.userId, reply_to: source });
    const privateId = await add("@agent my private instruction", { visible_to: f.luca.userId });
    const agent = await add("An agent's shared response", { sender_user_id: null, sender_agent_id: f.luca.agent.id, is_ai_generated: true });
    const luca = await login(f.luca.email); const marco = await login(f.marco.email);
    await luca.goto(`/chats/${f.group}`); await marco.goto(`/chats/${f.group}`);
    const original = luca.locator(`#m-${source}`); await original.hover();
    const deletedIcon = original.getByRole("button", { name: "Delete", exact: true }); const forwardIcon = original.getByRole("button", { name: "Forward", exact: true });
    expect((await deletedIcon.boundingBox())!.x).toBeLessThan((await forwardIcon.boundingBox())!.x);
    await expect(marco.locator(`#m-${source}`).getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
    await expect(luca.locator(`#m-${reply}`).getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
    await expect(luca.locator(`#m-${agent}`).getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
    await expect(marco.locator(`#m-${privateId}`)).toHaveCount(0);
    const sent = await original.getByTestId("message-timestamp").locator("time").getAttribute("datetime");
    await deletedIcon.click(); let confirmation = luca.getByRole("dialog", { name: "Delete message", exact: true });
    await expect(confirmation).toContainText("Delete this message for everyone?"); await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(original).toContainText("The pitch is booked for 7pm");
    await marco.locator(`#m-${source}`).getByRole("button", { name: "Reply", exact: true }).click(); await expect(marco.getByTestId("replying-to")).toBeVisible();
    await original.getByLabel("Message options").click(); await original.locator("details").getByRole("button", { name: "Delete", exact: true }).click();
    confirmation = luca.getByRole("dialog", { name: "Delete message", exact: true }); await confirmation.getByRole("button", { name: "Delete for everyone", exact: true }).click();
    for (const page of [luca, marco]) {
      const row = page.locator(`#m-${source}`); await expect(row.getByTestId("deleted-message")).toContainText("Message deleted on");
      await expect(row).not.toContainText("The pitch is booked for 7pm"); await expect(row.getByTestId("message-timestamp").locator("time")).toHaveAttribute("datetime", sent!);
      await expect(row.getByTestId("message-receipt")).toHaveCount(0); await expect(row.getByLabel("Message options")).toHaveCount(0);
      await expect(row.getByRole("button", { name: /^(Reply|Forward|Delete)$/ })).toHaveCount(0);
      await expect(page.locator(`#m-${reply}`).getByTestId("quote")).toHaveText("Deleted message");
    }
    await expect(marco.getByTestId("replying-to")).toHaveCount(0);
    const { data: saved } = await f.db.from("messages").select("deleted_at").eq("id", source).single();
    await expect(original.getByTestId("deleted-message").locator("time")).toHaveAttribute("datetime", saved!.deleted_at!);
    // Private input can be deleted, but its placeholder must remain private.
    await luca.locator(`#m-${privateId}`).getByRole("button", { name: "Delete", exact: true }).click();
    confirmation = luca.getByRole("dialog", { name: "Delete message", exact: true }); await expect(confirmation).toContainText("Delete this private message?"); await confirmation.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(luca.locator(`#m-${privateId}`).getByTestId("deleted-message")).toBeVisible(); await expect(marco.locator(`#m-${privateId}`)).toHaveCount(0);
  } finally { for (const context of sessions) await context.close(); await f.cleanup(); }
});

test("mobile menu deletes human messages in DMs, My Agent, business-agent chats and communities", async ({ browser }) => {
  const f = await planBusinessFixture(); const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); let community: string | undefined;
  try {
    const { data: dm } = await f.db.from("conversations").insert({ kind: "dm", created_by: f.luca.userId }).select("id").single();
    await f.db.from("conversation_members").insert([f.luca, f.marco].map((p) => ({ conversation_id: dm!.id, user_id: p.userId })));
    const { data: made } = await f.db.from("communities").insert({ owner_id: f.luca.userId, name: "Mobile deletion", description: "A temporary deletion test community", visibility: "private" }).select("id").single(); community = made!.id;
    await f.db.from("community_members").insert({ community_id: community, user_id: f.luca.userId, role: "owner" });
    const { data: channel } = await f.db.from("conversations").insert({ kind: "channel", community_id: community, channel: "general", title: "General", created_by: f.luca.userId }).select("id").single();
    await f.db.from("conversation_members").insert({ conversation_id: channel!.id, user_id: f.luca.userId });
    const { data: thread } = await f.db.from("agent_threads").insert({ owner_id: f.luca.userId, conversation_id: f.myAgent, title: "Delete checks" }).select("id").single();
    const { data: ownAgent } = await f.db.from("messages").insert({ conversation_id: f.myAgent, thread_id: thread!.id, sender_agent_id: f.luca.agent.id, is_ai_generated: true, content: "Agent-authored output stays" }).select("id").single();
    const page = await context.newPage(); await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(f.luca.email); await page.getByLabel("Password", { exact: true }).fill(f.password); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(/\/chats/);
    for (const conversation of [dm!.id, f.myAgent, f.direct, channel!.id]) {
      const { data: message, error } = await f.db.from("messages").insert({ conversation_id: conversation, sender_user_id: f.luca.userId, thread_id: conversation === f.myAgent ? thread!.id : null, is_ai_generated: false, content: "My message to delete" }).select("id").single(); if (error) throw error;
      await page.goto(`/chats/${conversation}${conversation === f.myAgent ? `?t=${thread!.id}` : ""}`);
      const row = page.locator(`#m-${message!.id}`); await row.getByLabel("Message options").click(); await row.locator("details").getByRole("button", { name: "Delete", exact: true }).click();
      await page.getByRole("dialog", { name: "Delete message", exact: true }).getByRole("button", { name: "Delete for everyone", exact: true }).click();
      await expect(row.getByTestId("deleted-message")).toContainText("Message deleted on");
      if (conversation === f.myAgent) await expect(page.locator(`#m-${ownAgent!.id}`).getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
    }
  } finally { await context.close(); if (community) await f.db.from("communities").delete().eq("id", community); await f.cleanup(); }
});

test("deleting rich media revokes downloads and deleting a native poll leaves the activity intact", async ({ browser }) => {
  const f = await planBusinessFixture(); const context = await browser.newContext();
  try {
    const page = await context.newPage(); await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(f.luca.email); await page.getByLabel("Password", { exact: true }).fill(f.password); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(/\/chats/); await page.goto(`/chats/${f.group}`);
    const photo = await sharp({ create: { width: 120, height: 80, channels: 3, background: "green" } }).png().toBuffer();
    await page.getByLabel("Choose attachments", { exact: true }).setInputFiles([{ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Notes to delete") }, { name: "photo.png", mimeType: "image/png", buffer: photo }]);
    await expect(page.getByTestId("attachment-card")).toHaveCount(2); await page.getByRole("textbox", { name: "Message", exact: true }).fill("My files and caption"); await page.getByRole("button", { name: "Send", exact: true }).click(); await expect(page.getByTestId("attachment-preview")).toHaveCount(0);
    const { data: rich } = await f.db.from("messages").select("id").eq("conversation_id", f.group).eq("content", "My files and caption").single(); const row = page.locator(`#m-${rich!.id}`);
    const download = await row.getByRole("link", { name: /notes.txt/ }).getAttribute("href"); expect((await page.request.get(download!)).status()).toBe(200);
    await row.getByRole("button", { name: "Delete", exact: true }).click(); await page.getByRole("dialog", { name: "Delete message", exact: true }).getByRole("button", { name: "Delete for everyone", exact: true }).click();
    await expect(row.getByTestId("deleted-message")).toBeVisible(); await expect(row.getByRole("img")).toHaveCount(0); await expect(row.getByRole("link")).toHaveCount(0); expect((await page.request.get(download!)).status()).toBe(404);
    const { data: poll } = await f.db.rpc("create_chat_poll", { p_owner: f.luca.userId, p_agent: f.luca.agent.id, p_origin: f.group, p_group: f.group, p_thread: null, p_client: crypto.randomUUID(), p_question: "Pizza or sushi?", p_options: ["Pizza", "Sushi"], p_voters: [f.luca.agent.handle, f.marco.agent.handle] });
    await expect(page.locator(`#m-${poll}`).getByTestId("poll")).toBeVisible();
    const { data: message } = await f.db.from("messages").select("metadata").eq("id", poll!).single(); const step = (message!.metadata as { step_id: string }).step_id;
    const before = (await f.db.from("plan_steps").select("status,result").eq("id", step).single()).data;
    await page.locator(`#m-${poll}`).getByRole("button", { name: "Delete", exact: true }).click(); await page.getByRole("dialog", { name: "Delete message", exact: true }).getByRole("button", { name: "Delete for everyone", exact: true }).click();
    await expect(page.locator(`#m-${poll}`).getByTestId("deleted-message")).toBeVisible(); await expect(page.locator(`#m-${poll}`).getByTestId("poll")).toHaveCount(0);
    expect((await f.db.from("plan_steps").select("status,result").eq("id", step).single()).data).toEqual(before);
    const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } }); await auth.auth.signInWithPassword({ email: f.marco.email, password: f.password });
    expect((await auth.rpc("delete_own_message", { p_message: rich!.id })).error).toBeTruthy();
  } finally {
    await context.close();
    const { data: objects } = await f.db.storage.from("chat-attachments").list(f.luca.userId, { limit: 1000 }); const paths = (objects ?? []).map((object) => `${f.luca.userId}/${object.name}`);
    if (paths.length) await f.db.storage.from("chat-attachments").remove(paths); await f.cleanup(); if (paths.length) await f.db.from("chat_attachment_gc").delete().in("path", paths);
  }
});
