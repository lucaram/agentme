import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { config } from "dotenv";
import { planBusinessFixture } from "../tests/fixtures/plan-business";

config({ path: ".env.local", quiet: true });

async function login(context: BrowserContext, email: string, password: string) {
  const page = await context.newPage(); await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(password); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(/\/chats/); return page;
}
const ready = (page: Page) => expect(page.getByTestId("chat-scroll")).toHaveAttribute("data-chat-ready", "true");
const bottom = (page: Page) => page.getByTestId("chat-scroll").evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
async function visibleAnchor(page: Page) {
  return page.getByTestId("chat-scroll").evaluate((el) => { const top = el.getBoundingClientRect().top; const row = [...el.querySelectorAll<HTMLElement>("[data-timeline-message]")].find((node) => node.getBoundingClientRect().bottom > top + 1); return row ? { id: row.dataset.timelineMessage!, offset: row.getBoundingClientRect().top - top } : null; });
}
const offsetOf = (page: Page, id: string) => page.locator(`#m-${id}`).evaluate((el) => el.getBoundingClientRect().top - el.closest("[data-chat-scroll]")!.getBoundingClientRect().top);

test("50-message chunks load automatically, keep an anchor and restore history while new arrivals wait below", async ({ browser }) => {
  test.setTimeout(180000);
  const f = await planBusinessFixture(); const context = await browser.newContext();
  let releaseRefresh = () => {};
  try {
    const rows = Array.from({ length: 260 }, (_, i) => ({ id: crypto.randomUUID(), conversation_id: f.group, sender_user_id: f.luca.userId, is_ai_generated: false, content: `History message ${String(i).padStart(4, "0")}`, created_at: new Date(Date.UTC(2026, 10, 14, 9, 0, i)).toISOString() }));
    expect((await f.db.from("messages").insert(rows)).error).toBeNull();
    const page = await login(context, f.luca.email, f.password); const historyRequests: { mode: string; count: number }[] = [];
    page.on("response", (response) => { if (response.url().includes(`/api/chats/${f.group}/history`)) void response.json().then((data) => { if (Array.isArray(data.messages)) historyRequests.push({ mode: new URL(response.url()).searchParams.get("mode")!, count: data.messages.length }); }).catch(() => {}); });
    await page.goto(`/chats/${f.group}`); await ready(page); await expect(page.locator("[data-timeline-message]")).toHaveCount(50); await expect.poll(() => bottom(page)).toBeLessThan(4);
    await expect(page.locator(`#m-${rows[259].id}`)).toBeInViewport(); await expect(page.locator(`#m-${rows[0].id}`)).toHaveCount(0);
    const scroll = page.getByTestId("chat-scroll");
    await scroll.evaluate((el) => { el.scrollTop = 0; }); const first = await visibleAnchor(page); await scroll.hover(); await page.mouse.wheel(0, -700);
    await expect(page.locator("[data-timeline-message]")).toHaveCount(100); await expect.poll(async () => Math.abs(await offsetOf(page, first!.id) - first!.offset)).toBeLessThan(5);
    // A slow live refresh must preserve a newer scroll gesture and still load the next chunk.
    let held = false; const gate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    await page.route(`**/api/chats/${f.group}/history?**`, async (route) => {
      if (!held && new URL(route.request().url()).searchParams.get("mode") === "refresh") { held = true; await gate; }
      await route.continue();
    });
    expect((await f.db.from("messages").update({ metadata: { history_scroll_test: true } }).eq("id", rows[210].id)).error).toBeNull();
    await expect.poll(() => held).toBe(true);
    await scroll.evaluate((el) => { el.scrollTop = 0; }); await scroll.hover(); await page.mouse.wheel(0, -700);
    const duringRefresh = await visibleAnchor(page); releaseRefresh();
    await expect(page.locator("[data-timeline-message]")).toHaveCount(150);
    await expect.poll(async () => Math.abs(await offsetOf(page, duringRefresh!.id) - duringRefresh!.offset)).toBeLessThan(5);
    for (const expected of [150]) {
      const before = await page.locator("[data-timeline-message]").first().getAttribute("data-timeline-message");
      await scroll.evaluate((el) => { el.scrollTop = 0; }); await scroll.hover(); await page.mouse.wheel(0, -700);
      await expect.poll(() => page.locator("[data-timeline-message]").first().getAttribute("data-timeline-message")).not.toBe(before); await expect(page.locator("[data-timeline-message]")).toHaveCount(expected);
    }
    const saved = await visibleAnchor(page); await page.goto("/settings/profile"); await page.goto(`/chats/${f.group}`); await ready(page);
    await expect.poll(async () => (await visibleAnchor(page))?.id).toBe(saved!.id); expect(Math.abs((await visibleAnchor(page))!.offset - saved!.offset)).toBeLessThan(6);
    await page.getByRole("navigation").first().getByRole("link", { name: "Settings", exact: true }).click(); await expect(page).toHaveURL(/\/settings$/); await page.goBack(); await ready(page);
    await expect.poll(async () => (await visibleAnchor(page))?.id).toBe(saved!.id); expect(Math.abs((await visibleAnchor(page))!.offset - saved!.offset)).toBeLessThan(6);
    const before = await visibleAnchor(page);
    const { data: incoming } = await f.db.from("messages").insert({ conversation_id: f.group, sender_user_id: f.marco.userId, is_ai_generated: false, content: "A new reply while Luca reads history" }).select("id").single();
    await expect(page.getByTestId("jump-to-latest")).toContainText("1 new"); expect((await visibleAnchor(page))!.id).toBe(before!.id); expect(Math.abs((await visibleAnchor(page))!.offset - before!.offset)).toBeLessThan(6);
    expect((await f.db.from("message_views").select("viewed_at").eq("message_id", incoming!.id).eq("user_id", f.luca.userId).maybeSingle()).data?.viewed_at).toBeFalsy();
    await page.getByTestId("jump-to-latest").click(); await expect(page.locator(`#m-${incoming!.id}`)).toBeInViewport(); await expect.poll(() => bottom(page)).toBeLessThan(4);
    await expect.poll(async () => (await f.db.from("message_views").select("viewed_at").eq("message_id", incoming!.id).eq("user_id", f.luca.userId).maybeSingle()).data?.viewed_at).toBeTruthy();
    const { data: next } = await f.db.from("messages").insert({ conversation_id: f.group, sender_user_id: f.marco.userId, is_ai_generated: false, content: "Follow this reply at the bottom" }).select("id").single();
    await expect(page.locator(`#m-${next!.id}`)).toBeInViewport(); await expect.poll(() => bottom(page)).toBeLessThan(4);
    await scroll.evaluate((el) => { el.scrollTop = 200; }); await page.getByRole("textbox", { name: "Message", exact: true }).fill("My reply returns to the bottom"); await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("list", { name: "Messages", exact: true }).getByText("My reply returns to the bottom", { exact: true })).toBeInViewport(); await expect.poll(() => bottom(page)).toBeLessThan(4);
    expect(historyRequests.filter((r) => r.mode === "before").length).toBeGreaterThanOrEqual(3); expect(historyRequests.every((r) => r.count <= 50)).toBe(true);
  } finally { releaseRefresh(); await context.close(); await f.cleanup(); }
});

test("first-unread opening and jumping to the bottom never mark skipped messages seen", async ({ browser }) => {
  const f = await planBusinessFixture(); const context = await browser.newContext();
  let releaseRefresh = () => {};
  try {
    const rows = Array.from({ length: 200 }, (_, i) => ({ id: crypto.randomUUID(), conversation_id: f.group, sender_user_id: f.marco.userId, is_ai_generated: false, content: `Unread message ${i}`, created_at: new Date(Date.now() + i).toISOString() }));
    expect((await f.db.from("messages").insert(rows)).error).toBeNull();
    const page = await login(context, f.luca.email, f.password);
    let held = false; const gate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    await page.route(`**/api/chats/${f.group}/history?**`, async (route) => {
      if (!held && new URL(route.request().url()).searchParams.get("mode") === "refresh") { held = true; await gate; }
      await route.continue();
    });
    await page.goto(`/chats/${f.group}`); await ready(page);
    await expect(page.getByTestId("new-messages-divider")).toBeInViewport(); await expect(page.locator(`#m-${rows[0].id}`)).toBeInViewport(); await expect(page.locator("[data-timeline-message]")).toHaveCount(30);
    await expect.poll(async () => (await f.db.from("message_views").select("viewed_at").eq("message_id", rows[0].id).eq("user_id", f.luca.userId).maybeSingle()).data?.viewed_at).toBeTruthy();
    await expect.poll(() => held).toBe(true);
    await page.getByTestId("jump-to-latest").click(); releaseRefresh(); await expect(page.locator(`#m-${rows[199].id}`)).toBeInViewport();
    await expect.poll(async () => (await f.db.from("message_views").select("viewed_at").eq("message_id", rows[199].id).eq("user_id", f.luca.userId).maybeSingle()).data?.viewed_at).toBeTruthy();
    expect((await f.db.from("message_views").select("viewed_at").eq("message_id", rows[80].id).eq("user_id", f.luca.userId).maybeSingle()).data?.viewed_at).toBeFalsy();
    await page.reload(); await ready(page); await expect(page.getByTestId("new-messages-divider")).toBeInViewport(); await expect(page.locator(`#m-${rows[80].id}`)).toHaveCount(0);
  } finally { releaseRefresh(); await context.close(); await f.cleanup(); }
});

test("quote jumps can fetch an older chunk without losing normal reply behaviour", async ({ browser }) => {
  const f = await planBusinessFixture(); const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const rows = Array.from({ length: 90 }, (_, i) => ({ id: crypto.randomUUID(), conversation_id: f.group, sender_user_id: f.luca.userId, is_ai_generated: false, content: `Message ${i}`, created_at: new Date(Date.UTC(2026, 10, 14, 9, 0, i)).toISOString() }));
    expect((await f.db.from("messages").insert(rows)).error).toBeNull();
    const { data: reply } = await f.db.from("messages").insert({ conversation_id: f.group, sender_user_id: f.luca.userId, is_ai_generated: false, content: "A reply to the first message", reply_to: rows[0].id }).select("id").single();
    const page = await login(context, f.luca.email, f.password); await page.goto(`/chats/${f.group}`); await ready(page); await expect(page.locator(`#m-${rows[0].id}`)).toHaveCount(0);
    const latest = page.locator(`#m-${reply!.id}`); await latest.getByLabel("Message options").click(); await expect(latest.locator("details").getByRole("button", { name: "Delete", exact: true })).toBeInViewport({ ratio: 1 }); await latest.getByLabel("Message options").click();
    await page.locator(`#m-${reply!.id}`).getByTestId("quote").click(); await expect(page.locator(`#m-${rows[0].id}`)).toBeInViewport(); await expect(page.locator(`#m-${rows[0].id}`)).toHaveClass(/reply-flash/);
    await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeInViewport(); await expect(page.getByTestId("jump-to-latest")).toBeVisible();
  } finally { await context.close(); await f.cleanup(); }
});
