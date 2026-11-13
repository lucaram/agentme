import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

// A chat with more than 200 messages used to show its first 200 and nothing after them
// (while still being marked as read). It now shows the latest, with "Show earlier messages".

test("a long chat shows its latest messages, and earlier ones on request", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill("luca@agentme.test");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/chats/);

  // A new group with Marco.
  const name = `Long chat ${`${Date.now()}`.slice(-6)}`;
  await page.getByRole("navigation").getByRole("link", { name: "Groups" }).click();
  await page.getByRole("button", { name: "＋ New group" }).click();
  const form = page.getByRole("form", { name: "New group" });
  await form.getByLabel("Group name").fill(name);
  await form.getByRole("combobox", { name: "Search contacts" }).fill("mar");
  await form.getByRole("option", { name: /Marco/ }).click();
  await form.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  const chatUrl = page.url().replace("/groups/", "/chats/");
  const conversationId = chatUrl.split("/chats/")[1].split(/[?#]/)[0];

  // 205 messages from Luca, one second apart, the last one just now.
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: luca } = await db.from("agents").select("owner_id").eq("handle", "luca").single();
  const now = Date.now();
  const rows = Array.from({ length: 205 }, (_, i) => ({
    conversation_id: conversationId,
    sender_user_id: luca!.owner_id,
    content: `long-chat-${String(i + 1).padStart(3, "0")}`,
    is_ai_generated: false,
    created_at: new Date(now - (205 - i) * 1000).toISOString(),
  }));
  const { error } = await db.from("messages").insert(rows);
  expect(error).toBeNull();

  await page.goto(chatUrl);
  // The newest is there; the oldest five are not, until asked for.
  await expect(page.getByText("long-chat-205", { exact: true })).toBeVisible();
  await expect(page.getByText("long-chat-006", { exact: true })).toBeVisible();
  await expect(page.getByText("long-chat-001", { exact: true })).toHaveCount(0);
  await page.getByTestId("show-earlier").click();
  await expect(page).toHaveURL(/earlier=1/);
  await expect(page.getByText("long-chat-001", { exact: true })).toBeVisible();
  await expect(page.getByText("long-chat-205", { exact: true })).toBeVisible();
  await expect(page.getByTestId("show-earlier")).toHaveCount(0);

  // A new message lands at the end, where the reader is.
  await page.getByLabel("Message", { exact: true }).fill("and one more");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "and one more" })).toBeVisible();
  await context.close();
});
