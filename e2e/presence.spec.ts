import { expect, test, type Browser, type Page } from "@playwright/test";
import { config } from "dotenv";
import { planBusinessFixture } from "../tests/fixtures/plan-business";
import { onboardingFixture } from "../tests/fixtures/onboarding";
config({ path: ".env.local", quiet: true });

async function login(browser: Browser, account: { email: string }, password: string) {
  const context = await browser.newContext(); const page = await context.newPage();
  await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(account.email); await page.getByLabel("Password", { exact: true }).fill(password); await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/chats/); await expect(page.getByTestId("own-presence")).not.toContainText("Connecting");
  return { context, page };
}
async function status(page: Page, name: string) {
  await page.getByTestId("identity-switcher").click(); await page.getByRole("group", { name: "Set your status", exact: true }).getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("group", { name: "Set your status", exact: true }).getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("identity-switcher").click();
}
async function contacts(page: Page) { await page.goto("/contacts"); await page.getByTestId("fold-contacts").locator("summary").first().click(); }

test("contacts and chat headers show live human status; invisible and privacy have different meanings", async ({ browser }) => {
  const f = await planBusinessFixture(); const sessions: Awaited<ReturnType<typeof login>>[] = [];
  try {
    expect((await f.db.from("contacts").insert({ requester_agent: f.luca.agent.id, addressee_agent: f.marco.agent.id, status: "accepted" })).error).toBeNull();
    const luca = await login(browser, f.luca, f.password); sessions.push(luca); const marco = await login(browser, f.marco, f.password); sessions.push(marco);
    await contacts(marco.page); const badge = marco.page.getByTestId(`presence-${f.luca.agent.id}`); await expect(badge).toHaveText("Online");
    await status(luca.page, "Busy"); await expect(badge).toHaveText("Busy");
    await luca.page.getByTestId("identity-switcher").click(); await luca.page.getByRole("combobox", { name: "Busy for", exact: true }).selectOption("forever"); await expect(luca.page.getByTestId("busy-until")).toHaveText("Busy until changed");
    await luca.page.reload(); await expect(luca.page.getByTestId("own-presence")).toHaveText("Busy"); await luca.page.getByTestId("identity-switcher").click(); await expect(luca.page.getByTestId("busy-until")).toHaveText("Busy until changed"); await luca.page.getByTestId("identity-switcher").click();
    await status(luca.page, "Away"); await expect(badge).toHaveText("Away");
    await status(luca.page, "Appear offline"); await expect(badge).toHaveText("Offline"); await expect(luca.page.getByTestId("own-presence")).toContainText("Appear offline");
    await status(luca.page, "Online (automatic)"); await expect(badge).toHaveText("Online");
    await marco.page.getByRole("button", { name: "Message", exact: true }).click(); await expect(marco.page).toHaveURL(/\/chats\//); await expect(badge).toHaveText("Online");
    const search = marco.page.getByRole("combobox"); await search.fill(f.luca.agent.handle); await expect(marco.page.getByRole("listbox")).toContainText("Online"); await search.press("Escape");
    await luca.page.goto("/settings/privacy"); const online = luca.page.getByRole("heading", { name: "Online status", exact: true }).locator(".."); await online.getByRole("radio", { name: /Nobody/ }).check(); await luca.page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(badge).toHaveCount(0);
    const hidden = await marco.page.request.get(`/api/presence?ids=${f.luca.agent.id}`); expect((await hidden.json()).peers).toEqual([]);
    await online.getByRole("radio", { name: /My contacts/ }).check(); await luca.page.getByRole("button", { name: "Save", exact: true }).click(); await expect(badge).toHaveText("Online");
    await expect(luca.page.getByRole("checkbox", { name: /Share when I've seen messages/ })).toBeChecked();
    await f.db.from("contacts").update({ status: "blocked", blocked_by: f.luca.agent.id }).eq("requester_agent", f.luca.agent.id).eq("addressee_agent", f.marco.agent.id);
    await expect(badge).toHaveCount(0);
  } finally { await Promise.allSettled(sessions.map((s) => s.context.close())); await f.cleanup(); }
});

test("background and idle tabs become Away; another connected device keeps the user online", async ({ browser }) => {
  const f = await planBusinessFixture(); const sessions: Awaited<ReturnType<typeof login>>[] = [];
  try {
    await f.db.from("contacts").insert({ requester_agent: f.luca.agent.id, addressee_agent: f.marco.agent.id, status: "accepted" });
    const luca = await login(browser, f.luca, f.password); sessions.push(luca); const marco = await login(browser, f.marco, f.password); sessions.push(marco);
    await contacts(marco.page); const badge = marco.page.getByTestId(`presence-${f.luca.agent.id}`); await expect(badge).toHaveText("Online");
    await luca.page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
    await expect(badge).toHaveText("Away");
    const second = await login(browser, f.luca, f.password); sessions.push(second); await expect(badge).toHaveText("Online");
    await second.context.close(); await expect(badge).toHaveText("Away");
    await luca.page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
    await expect(badge).toHaveText("Online");
    await luca.page.clock.install(); await luca.page.clock.fastForward(5 * 60_000 + 1000); await expect(badge).toHaveText("Away");
    await luca.context.close(); await expect(badge).toHaveText("Offline", { timeout: 45_000 });
  } finally { await Promise.allSettled(sessions.map((s) => s.context.close())); await f.cleanup(); }
});

test("business search and agent chats show team availability only when enabled; the agent can answer while staff are offline", async ({ browser }) => {
  const f = await planBusinessFixture(); const sessions: Awaited<ReturnType<typeof login>>[] = [];
  try {
    const owner = await login(browser, f.business, f.password); sessions.push(owner); const luca = await login(browser, f.luca, f.password); sessions.push(luca);
    await expect(owner.page.getByTestId("own-presence")).toHaveText("Work: Online");
    await luca.page.goto(`/discover?q=${f.business.agent.handle}`); const badge = luca.page.getByTestId(`presence-${f.business.agent.id}`); await expect(badge).toHaveCount(0);
    await owner.page.goto("/settings/privacy"); await owner.page.getByRole("checkbox", { name: /Show team availability to customers/ }).check(); await owner.page.getByRole("button", { name: "Save", exact: true }).click(); await expect(badge).toHaveText("Team online");
    await status(owner.page, "Busy"); await expect(badge).toHaveText("Team busy");
    await luca.page.goto(`/discover?q=${f.marco.agent.handle}`); await expect(luca.page.getByTestId(`presence-${f.marco.agent.id}`)).toHaveCount(0);
    await luca.page.goto(`/chats/${f.direct}`); await expect(badge).toHaveText("Team busy");
    await owner.page.getByRole("button", { name: "Log out", exact: true }).click(); await expect(owner.page).toHaveURL(/\/login/); await expect(badge).toHaveText("Team offline", { timeout: 45_000 });
    await luca.page.getByRole("textbox", { name: "Message", exact: true }).fill("Are you open on Mondays?"); await luca.page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(luca.page.getByText(/We are closed Mondays|closed on Mondays/i).last()).toBeVisible(); await expect(badge).toHaveText("Team offline");
    await luca.page.setViewportSize({ width: 390, height: 844 }); expect(await luca.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await luca.page.screenshot({ path: "test-results/presence-business-mobile.png" });
  } finally { await Promise.allSettled(sessions.map((s) => s.context.close())); await f.cleanup(); }
});

test("switching identities publishes only the selected identity and preserves separate status choices", async ({ browser }) => {
  const f = await onboardingFixture(); const sessions: Awaited<ReturnType<typeof login>>[] = [];
  try {
    const person = await f.user(); const viewer = await f.user();
    for (const [account, handle] of [[person, `person_${f.tag}`], [viewer, `viewer_${f.tag}`]] as const) {
      expect((await f.db.from("agents").insert({ owner_id: account.id, handle, display_name: handle, type: "personal" })).error).toBeNull();
    }
    const owner = await login(browser, person, f.password); sessions.push(owner); const customer = await login(browser, viewer, f.password); sessions.push(customer);
    await status(owner.page, "Busy"); await owner.page.goto("/business/new"); await owner.page.getByLabel("Business name").fill(`Presence ${f.tag}`);
    await expect(owner.page.getByRole("button", { name: "Create business", exact: true })).toBeEnabled(); await owner.page.getByRole("button", { name: "Create business", exact: true }).click(); await expect(owner.page).toHaveURL(/\/chats\//);
    await expect(owner.page.getByTestId("own-presence")).toHaveText("Work: Online");
    const { data: business } = await f.db.from("agents").select("id,handle").eq("handle", `presence_${f.tag}`).single(); expect(business).toBeTruthy();
    await owner.page.goto("/settings/privacy"); await owner.page.getByRole("checkbox", { name: /Show team availability to customers/ }).check(); await owner.page.getByRole("button", { name: "Save", exact: true }).click();
    await customer.page.goto(`/discover?q=${business!.handle}`); const badge = customer.page.getByTestId(`presence-${business!.id}`); await expect(badge).toHaveText("Team online");
    await owner.page.getByTestId("identity-switcher").click(); await owner.page.getByTestId(`identity-person_${f.tag}`).click();
    await expect(owner.page.getByTestId("own-presence")).toHaveText("Busy"); await expect(badge).toHaveText("Team offline");
    await owner.page.getByTestId("identity-switcher").click(); await owner.page.getByTestId(`identity-${business!.handle}`).click(); await expect(owner.page.getByTestId("own-presence")).toHaveText("Work: Online"); await expect(badge).toHaveText("Team online");
  } finally { await Promise.allSettled(sessions.map((s) => s.context.close())); await f.cleanup(); }
});
