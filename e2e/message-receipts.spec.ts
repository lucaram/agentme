import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { config } from "dotenv";
import { planBusinessFixture } from "../tests/fixtures/plan-business";

config({ path: ".env.local", quiet: true });

// Headless Chromium reports every page focused/visible, even after bringToFront.
// Supply the browser signals explicitly while exercising the real observer, RPCs and realtime UI.
async function tabActive(page: Page, active: boolean) {
  await page.evaluate((value) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value ? "visible" : "hidden" });
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => value });
    document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event(value ? "focus" : "blur"));
  }, active);
}

test("delivery, visible group viewing, background tabs and privacy update live", async ({ browser }) => {
  test.setTimeout(180000);
  const f = await planBusinessFixture(); const sessions: BrowserContext[] = [];
  async function login(email: string) {
    const context = await browser.newContext(); sessions.push(context); const page = await context.newPage();
    await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(f.password);
    await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(/\/chats/); return page;
  }
  async function add(content: string) {
    const { data, error } = await f.db.from("messages").insert({ conversation_id: f.group, sender_user_id: f.luca.userId, content, is_ai_generated: false }).select("id").single(); if (error) throw error; return data!.id;
  }
  async function sharedViews(id: string) { return (await f.db.from("message_receipts").select("seen_at").eq("message_id", id)).data!.filter((r) => r.seen_at).length; }
  try {
    const id = await add("A message for both friends"); const luca = await login(f.luca.email); await luca.goto(`/chats/${f.group}`);
    const indicator = (message: string) => luca.locator(`#m-${message}`).getByTestId("message-receipt");
    await expect(indicator(id)).toHaveAttribute("data-state", "sent");
    const marco = await login(f.marco.email);
    await expect.poll(async () => (await f.db.from("message_receipts").select("delivered_at").eq("message_id", id).eq("user_id", f.marco.userId).single()).data?.delivered_at).toBeTruthy();
    // Rendering the route through an authenticated HTTP request cannot mark it read.
    expect((await marco.request.get(`/chats/${f.group}`)).status()).toBe(200); expect(await sharedViews(id)).toBe(0);
    await marco.goto(`/chats/${f.group}`); await marco.bringToFront();
    await expect(indicator(id)).toHaveText("Seen by 1 of 2"); await expect(indicator(id)).toHaveAttribute("data-state", "partial");
    const blank = await marco.context().newPage(); await blank.goto("about:blank"); await blank.bringToFront();
    await tabActive(marco, false);
    await expect.poll(() => marco.evaluate(() => document.hasFocus())).toBe(false);
    const backgroundId = await add("Arrived in a background chat");
    await expect(marco.locator(`#m-${backgroundId}`)).toBeAttached();
    // Give the observer several dwell periods; a background page must never acknowledge viewing.
    await expect.poll(async () => (await f.db.from("message_receipts").select("delivered_at").eq("message_id", backgroundId).eq("user_id", f.marco.userId).single()).data?.delivered_at).toBeTruthy();
    await blank.waitForTimeout(1500); expect(await sharedViews(backgroundId)).toBe(0);
    await marco.bringToFront(); await tabActive(marco, true); await expect(indicator(backgroundId)).toHaveText("Seen by 1 of 2"); await blank.close();
    const paul = await login(f.paul.email); await paul.goto(`/chats/${f.group}`); await paul.bringToFront(); await tabActive(paul, true);
    await expect(indicator(id)).toHaveAttribute("data-state", "seen"); await expect(indicator(id)).toHaveText("Seen by 2 of 2");
    await tabActive(paul, false);
    await luca.bringToFront(); await indicator(id).click();
    const details = luca.getByRole("dialog", { name: "Message status", exact: true });
    await expect(details.getByRole("list", { name: "Receipt recipients" })).toContainText("Marco"); await expect(details).toContainText("Paul"); await expect(details.locator("time")).toHaveCount(5);
    await details.getByRole("button", { name: "Close message status" }).click();
    await marco.goto("/settings/privacy"); await marco.getByRole("checkbox", { name: /Share when I've seen messages/ }).uncheck(); await marco.getByRole("button", { name: "Save", exact: true }).click();
    await expect(marco).toHaveURL(/saved=1/); await expect(indicator(id)).toHaveText("Seen by 1 of 2");
    const privateView = await add("Privacy setting still clears my unread messages");
    await marco.goto(`/chats/${f.group}`); await marco.bringToFront();
    await expect.poll(async () => (await f.db.from("message_views").select("viewed_at").eq("message_id", privateView).eq("user_id", f.marco.userId).single()).data?.viewed_at).toBeTruthy();
    expect(await sharedViews(privateView)).toBe(0);
    // The timestamp remains the original sent time as receipt state changes.
    await expect(luca.locator(`#m-${id}`).getByTestId("message-timestamp").locator("time")).toHaveAttribute("datetime", /T/);
  } finally { for (const context of sessions) await context.close(); await f.cleanup(); }
});

test("offscreen messages stay unread until they enter the visible chat area", async ({ browser }) => {
  const f = await planBusinessFixture(); const context = await browser.newContext();
  try {
    const { data: messages, error } = await f.db.from("messages").insert(Array.from({ length: 12 }, (_, i) => ({ conversation_id: f.group, sender_user_id: f.luca.userId, content: `Message ${i}\n${"A long message\n".repeat(20)}`, is_ai_generated: false, created_at: new Date(Date.now() + i).toISOString() }))).select("id"); if (error) throw error;
    const page = await context.newPage(); await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(f.marco.email); await page.getByLabel("Password", { exact: true }).fill(f.password); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(/\/chats/);
    await page.goto(`/chats/${f.group}`); await page.bringToFront();
    const last = messages!.at(-1)!.id;
    await expect.poll(async () => (await f.db.from("message_views").select("viewed_at").eq("message_id", messages![0].id).eq("user_id", f.marco.userId).maybeSingle()).data?.viewed_at).toBeTruthy();
    expect((await f.db.from("message_views").select("viewed_at").eq("message_id", last).eq("user_id", f.marco.userId).maybeSingle()).data?.viewed_at).toBeFalsy();
    await page.locator(`#m-${last}`).scrollIntoViewIfNeeded();
    await expect.poll(async () => (await f.db.from("message_views").select("viewed_at").eq("message_id", last).eq("user_id", f.marco.userId).maybeSingle()).data?.viewed_at).toBeTruthy();
  } finally { await context.close(); await f.cleanup(); }
});

test("agent receipt is distinct from a business owner's actual view", async ({ browser }) => {
  test.setTimeout(180000);
  const f = await planBusinessFixture(); const sessions: BrowserContext[] = [];
  async function login(email: string) {
    const context = await browser.newContext(); sessions.push(context); const page = await context.newPage(); await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(f.password); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(/\/chats/); return page;
  }
  async function send(page: Page, text: string) { await page.getByRole("textbox", { name: "Message", exact: true }).fill(text); await page.getByRole("button", { name: "Send", exact: true }).click(); }
  try {
    const luca = await login(f.luca.email); await luca.goto(`/chats/${f.direct}`); await send(luca, "Are you open on Mondays?");
    const first = luca.getByTestId("message-receipt").first(); await expect(first).toHaveText("Agent received"); await expect(first).toHaveAttribute("data-state", "agent");
    const shop = await login(f.business.email); // An app delivery acknowledgement is not an owner view.
    await expect(first).toHaveText("Agent received");
    await send(luca, "Can you securely store four bicycles indoors?");
    await expect(luca.getByRole("button", { name: "Ask the team", exact: true })).toBeVisible();
    const question = luca.getByTestId("message-receipt").nth(1); await expect(question).toHaveText("Agent received");
    await luca.getByRole("button", { name: "Ask the team", exact: true }).click(); await expect(luca.getByRole("status").filter({ hasText: "Sent to the team" })).toBeVisible();
    expect((await f.db.from("message_receipt_tracking").select("owner_seen_at").eq("agent_id", f.business.agent.id).not("inbox_id", "is", null)).data?.filter((r) => r.owner_seen_at)).toEqual([]);
    await shop.getByTestId("my-agent-card").click(); await shop.bringToFront();
    await expect(shop.getByTestId("inbox-item").filter({ hasText: "four bicycles" })).toBeVisible();
    await expect(question).toHaveText("Seen by team"); await expect(question).toHaveAttribute("data-state", "seen");
    await expect(first).toHaveText("Agent received");
    await luca.bringToFront(); await question.click(); const details = luca.getByRole("dialog", { name: "Message status", exact: true });
    await expect(details).toContainText("An automatic reply does not confirm human viewing."); await expect(details.locator("time")).toHaveCount(3);
  } finally { for (const context of sessions) await context.close(); await f.cleanup(); }
});

test("direct messages show compact sent, delivered and seen icons beside the sent timestamp", async ({ browser }) => {
  const f = await planBusinessFixture(); const sessions: BrowserContext[] = [];
  async function login(email: string) {
    const context = await browser.newContext(); sessions.push(context); const page = await context.newPage(); await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(f.password); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(/\/chats/); return page;
  }
  try {
    const { data: conv, error } = await f.db.from("conversations").insert({ kind: "dm", created_by: f.luca.userId }).select("id").single(); if (error) throw error;
    await f.db.from("conversation_members").insert([f.luca, f.marco].map((p) => ({ conversation_id: conv!.id, user_id: p.userId })));
    const { data: message, error: messageError } = await f.db.from("messages").insert({ conversation_id: conv!.id, sender_user_id: f.luca.userId, content: "Hello Marco", is_ai_generated: false }).select("id").single(); if (messageError) throw messageError;
    const luca = await login(f.luca.email); await luca.goto(`/chats/${conv!.id}`);
    const row = luca.locator(`#m-${message!.id}`); const receipt = row.getByTestId("message-receipt");
    await expect(receipt).toHaveAttribute("data-state", "sent"); await expect(receipt).toHaveText("");
    const sent = await row.getByTestId("message-timestamp").textContent();
    const marco = await login(f.marco.email); await expect(receipt).toHaveAttribute("data-state", "delivered");
    await marco.goto(`/chats/${conv!.id}`); await marco.bringToFront(); await expect(receipt).toHaveAttribute("data-state", "seen");
    await expect(receipt).toHaveAccessibleName("Message status: Seen"); await expect(receipt).toHaveClass(/text-emerald/);
    await expect(row.getByTestId("message-timestamp")).toHaveText(sent!); await expect(marco.getByTestId("message-receipt")).toHaveCount(0);
  } finally { for (const context of sessions) await context.close(); await f.cleanup(); }
});
