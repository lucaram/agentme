import { expect, test, type BrowserContext } from "@playwright/test";
import { config } from "dotenv";
import { planBusinessFixture } from "../tests/fixtures/plan-business";

config({ path: ".env.local", quiet: true });
async function login(context: BrowserContext, email: string, password: string) {
  const page = await context.newPage(); await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(password); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(/\/chats/); return page;
}

test("reactions update live, replace or remove cleanly and show names and times without new messages", async ({ browser }) => {
  const f = await planBusinessFixture(); const lucaSession = await browser.newContext(); const marcoSession = await browser.newContext();
  try {
    const { data: message, error } = await f.db.from("messages").insert({ conversation_id: f.group, sender_user_id: f.luca.userId, content: "Our news for the group", is_ai_generated: false }).select("id").single(); expect(error).toBeNull();
    const luca = await login(lucaSession, f.luca.email, f.password); const marco = await login(marcoSession, f.marco.email, f.password);
    await luca.goto(`/chats/${f.group}`); await marco.goto(`/chats/${f.group}`);
    const a = luca.locator(`#m-${message!.id}`); const b = marco.locator(`#m-${message!.id}`);
    await expect(a.getByTestId("message-reactions")).toHaveCount(0); await expect(marco.getByRole("dialog", { name: "Choose a reaction", exact: true })).toHaveCount(0);
    await b.hover(); await b.getByRole("button", { name: "React", exact: true }).click();
    const picker = marco.getByRole("dialog", { name: "Choose a reaction", exact: true }); await expect(picker.getByRole("button")).toHaveCount(8);
    await picker.getByRole("button", { name: "Heart", exact: true }).click(); await expect(picker).toHaveCount(0);
    await expect(a.getByTestId("message-reactions")).toHaveText("❤️1");
    await a.hover(); await a.getByRole("button", { name: "React", exact: true }).click(); await luca.getByRole("dialog", { name: "Choose a reaction", exact: true }).getByRole("button", { name: "Heart", exact: true }).click();
    await expect(a.getByRole("button", { name: "Heart: 2, including you. View reactions", exact: true })).toBeVisible();
    await expect(b.getByTestId("message-reactions")).toHaveText("❤️2");
    await b.hover(); await b.getByRole("button", { name: "React", exact: true }).click(); await picker.getByRole("button", { name: "Happy", exact: true }).click();
    await expect(a.getByTestId("message-reactions")).toHaveText("❤️1🙂1");
    await a.getByRole("button", { name: "Happy: 1. View reactions", exact: true }).click();
    const people = luca.getByRole("dialog", { name: "Message reactions", exact: true }); await expect(people).toContainText("Marco"); await expect(people).toContainText("Luca");
    await expect(people.locator("time")).toHaveCount(2); await expect(people.locator("time").first()).toHaveText(/\d{2} \w{3}, \d{2}:\d{2}/);
    await people.getByRole("button", { name: "Close reactions", exact: true }).click();
    await b.hover(); await b.getByRole("button", { name: "React", exact: true }).click(); await expect(picker.getByRole("button", { name: "Happy", exact: true })).toHaveAttribute("aria-pressed", "true"); await picker.getByRole("button", { name: "Happy", exact: true }).click();
    await expect(a.getByTestId("message-reactions")).toHaveText("❤️1"); await luca.reload(); await expect(a.getByTestId("message-reactions")).toHaveText("❤️1");
    await a.hover(); await a.getByLabel("Message options", { exact: true }).click(); await expect(a.locator("details").getByRole("button", { name: "React", exact: true })).toHaveCount(0); await a.getByLabel("Message options", { exact: true }).click();
    const originalMessages = (await f.db.from("messages").select("id").eq("conversation_id", f.group)).data; expect(originalMessages).toHaveLength(1);
    await a.hover(); await a.getByRole("button", { name: "React", exact: true }).click(); await expect(luca.getByRole("dialog", { name: "Choose a reaction", exact: true })).toBeVisible();
    expect((await f.db.from("messages").update({ removed_at: new Date().toISOString(), content: "Removed" }).eq("id", message!.id)).error).toBeNull();
    await expect(a.getByTestId("message-reactions")).toHaveCount(0); await expect(b.getByRole("button", { name: "React", exact: true })).toHaveCount(0); await expect(luca.getByRole("dialog", { name: "Choose a reaction", exact: true })).toHaveCount(0);
  } finally { await lucaSession.close(); await marcoSession.close(); await f.cleanup(); }
});

test("mobile and keyboard pickers fit the viewport; shared agent output can receive reactions and private messages cannot", async ({ browser }) => {
  const f = await planBusinessFixture(); const context = await browser.newContext({ viewport: { width: 390, height: 700 }, isMobile: true, hasTouch: true });
  try {
    const { data: message, error } = await f.db.from("messages").insert({ conversation_id: f.direct, sender_agent_id: f.business.agent.id, content: "Here is the answer from our agent", is_ai_generated: true }).select("id").single(); expect(error).toBeNull();
    const { data: hidden } = await f.db.from("messages").insert({ conversation_id: f.direct, sender_user_id: f.luca.userId, content: "Private instruction", is_ai_generated: false, visible_to: f.luca.userId }).select("id").single();
    const page = await login(context, f.luca.email, f.password); await page.goto(`/chats/${f.direct}`);
    const row = page.locator(`#m-${message!.id}`); await expect(page.locator(`#m-${hidden!.id}`).getByRole("button", { name: "React", exact: true })).toHaveCount(0);
    await row.getByRole("button", { name: "React", exact: true }).click(); const picker = page.getByRole("dialog", { name: "Choose a reaction", exact: true }); await expect(picker).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(picker.getByRole("button", { name: "Heart", exact: true })).toBeFocused(); await page.keyboard.press("End"); await expect(picker.getByRole("button", { name: "Cry", exact: true })).toBeFocused(); await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0); await expect(row.getByRole("button", { name: "React", exact: true })).toBeFocused();
    await row.getByRole("button", { name: "React", exact: true }).click(); await picker.getByRole("button", { name: "Thumbs up", exact: true }).click(); await expect(row.getByTestId("message-reactions")).toHaveText("👍1");
    await page.screenshot({ path: "test-results/mobile-message-reaction.png" });
    await page.reload(); await expect(row.getByTestId("message-reactions")).toHaveText("👍1");
  } finally { await context.close(); await f.cleanup(); }
});
