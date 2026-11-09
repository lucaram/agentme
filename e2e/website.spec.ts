import { expect, test, type Browser, type Page } from "@playwright/test";

// "Paste your website": a business signs up with its website, reviews what its agent
// learned, tries it as a customer and goes live; then answers a question its website
// doesn't cover, once. The demo website is served by the app (public/demo/site).

/** My Business sections open one at a time: open the one a step needs (if it isn't already). */
async function openSection(page: Page, testId: string) {
  const fold = page.getByTestId(testId);
  if ((await fold.getAttribute("open")) === null) await fold.locator("summary").first().click();
}

async function as(browser: Browser, handle: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(`${handle}@agentme.test`);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/chats/);
  return { page, close: () => context.close() };
}

test("paste your website: sign-up fills itself in, the agent learns the site, the owner fixes, tries and goes live", async ({ browser, baseURL }) => {
  const id = `${Date.now()}`.slice(-8);
  const handle = `aurora${id}`;
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`cafe${id}@agentme.test`);
  await page.getByLabel("Password").fill("a-good-password");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Create your agent" })).toBeVisible();
  await page.getByRole("radio", { name: /Business/ }).click();

  // 1. One box: the form fills itself in from the homepage.
  await page.getByLabel(/Have a website/).fill(`${baseURL}/demo/site/index.html`);
  await page.getByRole("button", { name: "Fill in from it" }).click();
  await expect(page.getByTestId("website-filled")).toContainText("Filled in from localhost");
  await expect(page.getByLabel("Business name")).toHaveValue("Caffè Aurora");
  await expect(page.getByRole("button", { name: "Avatar ☕" })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Agent address").fill(handle);
  await expect(page.getByText(`@${handle} is available.`)).toBeVisible();
  await page.getByRole("button", { name: "Create my agent" }).click();

  // 2. The whole site is read (cart and other websites skipped), live.
  await expect(page).toHaveURL(/\/business\/setup$/);
  // 3. What the agent learned, each from its page.
  const learned = page.getByTestId("learned");
  await expect(learned).toBeVisible({ timeout: 30_000 });
  const hours = learned.getByTestId("learned-basic").filter({ hasText: "Opening hours" });
  await expect(hours).toContainText("Mon–Sat 8:00–17:00");
  await expect(learned.getByTestId("learned-fact").filter({ hasText: "Tiramisù £4.50" })).toContainText("localhost/demo/site/menu.html");
  // A fix beats the website from now on.
  await hours.getByRole("button", { name: "Fix Opening hours" }).click();
  await hours.getByRole("textbox", { name: "Fix Opening hours" }).fill("Mon–Sat 8:00–18:00 (summer)");
  await hours.getByRole("button", { name: "Save fix" }).click();
  await expect(hours).toContainText("Mon–Sat 8:00–18:00 (summer)");
  await expect(hours).toContainText("fixed by you");

  // 4. Try it as a customer: likely questions are answered straight away, with the page they came from.
  const oat = page.getByTestId("try-customer").filter({ hasText: "Do you have oat milk?" });
  await expect(oat).toContainText("oat and almond milk");
  await expect(oat).toContainText("📄 From localhost/demo/site/faq.html · checked today");

  // Go live.
  await page.getByRole("button", { name: "🚀 Go live" }).click();
  await expect(page).toHaveURL(/\/business\?live=1$/);
  await expect(page.getByTestId("site-live")).toBeVisible();
  const card = page.getByTestId("website-card");
  await expect(card).toContainText("● Live");
  await expect(card.getByTestId("website-status")).toContainText("4 pages read");
  await expect(card).toContainText("Not verified");

  // 6. A customer asks something the website doesn't say: answered once, it goes back to them and is remembered.
  const luca = await as(browser, "luca");
  await luca.page.goto(`/discover?q=${handle}`);
  await luca.page.getByRole("button", { name: "Ask agent" }).click();
  await luca.page.getByLabel("Message", { exact: true }).fill("Is there parking nearby?");
  await luca.page.getByRole("button", { name: "Send" }).click();
  await expect(luca.page.getByText("I've asked the team")).toBeVisible();

  await page.goto("/business");
  const gap = page.getByTestId("gaps").getByTestId("gap");
  await expect(gap).toContainText("A customer asked: “Is there parking nearby?”");
  await gap.getByRole("textbox").fill("Yes: free parking on Shore Street after 6pm.");
  await gap.getByRole("button", { name: "Send and remember" }).click();
  await expect(page.getByTestId("gap-done")).toContainText("Sent to the customer who asked");
  await openSection(page, "fold-faqs");
  await expect(page.getByTestId("faq-list")).toContainText("Is there parking nearby?");
  await luca.page.reload();
  await expect(luca.page.getByText("The team at Caffè Aurora: Yes: free parking on Shore Street after 6pm.")).toBeVisible();

  await Promise.all([context.close(), luca.close()]);
});
