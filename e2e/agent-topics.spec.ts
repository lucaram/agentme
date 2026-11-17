import { expect, test, type BrowserContext } from "@playwright/test";
import { config } from "dotenv";
import { planBusinessFixture } from "../tests/fixtures/plan-business";
import { agentTopicsFixture } from "../tests/fixtures/agent-topics";
config({ path: ".env.local", quiet: true });

async function login(context: BrowserContext, email: string, password: string) {
  const page = await context.newPage(); await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(password); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(/\/chats/); return page;
}

test("desktop topics page by ten, preserve navigation and scroll, search history and reflect live task changes", async ({ browser }) => {
  const f = await planBusinessFixture(); const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const fixture = await agentTopicsFixture(f); const page = await login(context, f.luca.email, f.password); await page.goto(`/chats/${f.myAgent}`);
    const topics = page.getByRole("complementary", { name: "My Agent topics", exact: true }); const scroll = topics.getByTestId("topic-scroll"); const links = topics.getByTestId("agent-thread");
    await expect(links).toHaveCount(10); await expect(links.first()).toContainText("Recent topic 01"); await expect(page.getByRole("region", { name: "Work in progress", exact: true })).toBeVisible();
    await scroll.hover(); await page.mouse.wheel(0, 1400); await expect(links).toHaveCount(20);
    await scroll.evaluate((el) => { el.scrollTop = 500; }); await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBe(500);
    const selected = fixture.rows.find((row) => row.title === "Recent topic 08")!; await topics.locator(`a[href$="?t=${selected.id}"]`).click();
    await expect(page).toHaveURL(new RegExp(`t=${selected.id}$`)); await expect(page.getByRole("list", { name: "Messages", exact: true })).toContainText("Update for Recent topic 08");
    await expect(topics.locator('[aria-current="page"]')).toContainText("Recent topic 08"); const savedScroll = await scroll.evaluate((el) => el.scrollTop);
    await page.getByTestId("back-to-my-agent").click(); await expect(links).toHaveCount(20); await expect.poll(() => scroll.evaluate((el, expected) => Math.abs(el.scrollTop - expected), savedScroll)).toBeLessThan(4);
    await topics.getByRole("button", { name: /^In progress/ }).click(); await expect(links).toHaveCount(10); await expect(links.first()).toContainText("Progress topic 01");
    await topics.getByRole("button", { name: "Load more", exact: true }).click(); await expect(links).toHaveCount(20); await topics.getByRole("button", { name: "Load more", exact: true }).click(); await expect(links).toHaveCount(23);
    await topics.getByRole("button", { name: /^History/ }).click(); await expect(links).toHaveCount(10); await topics.getByRole("button", { name: "Load more", exact: true }).click(); await expect(links).toHaveCount(13);
    await topics.getByRole("searchbox", { name: "Search topics", exact: true }).fill("History topic 13"); await expect(links).toHaveCount(1); await expect(links).toContainText("History topic 13");
    await topics.getByRole("button", { name: /^Recent/ }).click(); await expect(links).toHaveCount(20);
    await page.goto("/settings"); await page.goto(`/chats/${f.myAgent}`); await expect(links).toHaveCount(20);
    await expect.poll(() => scroll.evaluate((el, expected) => Math.abs(el.scrollTop - expected), savedScroll)).toBeLessThan(4);
    const waiting = fixture.tasks.find((task) => task.goal === "Progress topic 01")!; expect((await f.db.from("tasks").update({ status: "completed" }).eq("id", waiting.id)).error).toBeNull();
    await expect(topics.getByRole("button", { name: /^In progress/ })).toContainText("22"); await expect(topics.getByRole("button", { name: /^Recent/ })).toContainText("26");
    await expect(page.getByRole("region", { name: "Work in progress", exact: true })).not.toContainText("Progress topic 01");
    await page.screenshot({ path: "test-results/desktop-agent-topics.png" });
    await topics.getByTestId("topic-new-request").click(); await expect(page).toHaveURL(/t=new$/); await page.getByRole("textbox", { name: "Message", exact: true }).fill("Hello, can you help me?"); await page.getByRole("button", { name: "Send", exact: true }).click(); await expect(page).toHaveURL(/t=[0-9a-f-]{36}$/);
    await expect(page.getByRole("list", { name: "Messages", exact: true })).toContainText("Hello, can you help me?"); await expect(topics.getByTestId("agent-thread").first()).toContainText("Hello, can you help me?");
    const stranger = await context.request.get(`/api/chats/${f.group}/topics`); expect(stranger.status()).toBe(404);
  } finally { await Promise.allSettled([context.close()]); await f.cleanup(); }
});

test("mobile Topics drawer paginates, retries failed loads and opens a selected conversation", async ({ browser }) => {
  const f = await planBusinessFixture(); const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await agentTopicsFixture(f); const page = await login(context, f.luca.email, f.password); await page.goto(`/chats/${f.myAgent}`);
    await expect(page.getByRole("complementary", { name: "My Agent topics", exact: true })).not.toBeVisible();
    await page.getByRole("button", { name: /Topics/, exact: false }).click(); const drawer = page.getByRole("dialog", { name: "My Agent topics", exact: true }); const links = drawer.getByTestId("agent-thread");
    await expect(drawer).toBeInViewport({ ratio: 1 }); await expect(links).toHaveCount(10);
    await page.route("**/topics?**", async (route) => { const url = new URL(route.request().url()); if (url.searchParams.has("before")) { await route.fulfill({ status: 503, json: { error: "temporary test failure" } }); await page.unroute("**/topics?**"); } else await route.continue(); });
    await drawer.getByRole("button", { name: "Load more", exact: true }).click(); await expect(drawer.getByRole("alert")).toContainText("Couldn't load topics"); await expect(links).toHaveCount(10);
    await drawer.getByRole("button", { name: "Try again", exact: true }).click(); await expect(drawer.getByRole("alert")).toHaveCount(0); await expect(links).toHaveCount(20);
    await page.screenshot({ path: "test-results/mobile-agent-topics.png" }); await links.nth(12).click(); await expect(drawer).toHaveCount(0); await expect(page.getByRole("list", { name: "Messages", exact: true })).toContainText("Update for Recent topic 13");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: /Topics/ }).click(); await expect(drawer.locator('[aria-current="page"]')).toContainText("Recent topic 13"); await drawer.getByRole("button", { name: "Close topics", exact: true }).click();
  } finally { await Promise.allSettled([context.close()]); await f.cleanup(); }
});
