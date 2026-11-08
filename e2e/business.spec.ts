import { expect, test, type Browser, type Page } from "@playwright/test";

const PASSWORD = "password123";

async function as(browser: Browser, handle: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(`${handle}@agentme.test`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/chats/);
  return { page, close: () => context.close() };
}

async function send(page: Page, text: string) {
  await page.getByLabel("Message", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

test("my business: the agent reads the menu link, answers from it, and asks the team when it doesn't know", async ({ browser, baseURL }) => {
  // The business describes itself in plain language and adds its menu page.
  const shop = await as(browser, "trattoria");
  await shop.page.getByRole("navigation").first().getByRole("link", { name: "My Business" }).click();
  // A web address written in the text is added to the links the agent reads.
  await shop.page
    .getByRole("textbox", { name: /About your business/ })
    .fill(`Family-run Italian restaurant in Camden. Open Tue–Sun 12–15 and 18–23.
Our menu: ${baseURL}/demo/trattoria-menu.html`);
  await shop.page.getByRole("button", { name: "Save" }).click();
  await expect(shop.page.getByRole("status").filter({ hasText: "I also added 1 link from your text" })).toBeVisible();
  await expect(shop.page.getByTestId("source-status").first()).toContainText("✓ Read", { timeout: 20_000 });
  // Shown as the same link seen from two places, not a duplicate.
  await expect(shop.page.getByTestId("source-from-text")).toHaveCount(1);

  // Try it: answered from the menu it read.
  await shop.page.getByLabel("Test question").fill("Do you have panna cotta?");
  await shop.page.getByRole("button", { name: "See the answer" }).click();
  await expect(shop.page.getByTestId("try-answer")).toContainText("Panna cotta");

  // Questions & answers can be added by hand; the agent uses them straight away.
  await shop.page.getByRole("button", { name: "＋ Add a question" }).click();
  await shop.page.getByLabel("Question", { exact: true }).fill("Is there a kids menu?");
  await shop.page.getByLabel("Answer", { exact: true }).fill("Yes: small pasta and pizzas for £6.");
  await shop.page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(shop.page.getByTestId("faq-list")).toContainText("Is there a kids menu?");
  await shop.page.getByLabel("Test question").fill("Do you have a kids menu?");
  await shop.page.getByRole("button", { name: "See the answer" }).click();
  await expect(shop.page.getByTestId("try-answer")).toContainText("small pasta and pizzas");

  // A visitor asks something that isn't there: the agent says it asked the team.
  const luca = await as(browser, "luca");
  await luca.page.goto("/discover?q=tratt");
  await luca.page.getByRole("button", { name: "Ask agent" }).click();
  await send(luca.page, "Is there parking nearby?");
  await expect(luca.page.getByText("I've asked the team")).toBeVisible();

  // The business answers under Needs your answer; it goes back to Luca and into the business info.
  await shop.page.goto("/chats");
  await shop.page.getByTestId("my-agent-card").click();
  const item = shop.page.getByTestId("inbox-item").filter({ hasText: "asked your business" });
  await item.getByLabel(/Your answer/).fill("Yes, a public car park two minutes away on Pratt Street.");
  await item.getByRole("button", { name: "Send answer" }).click();
  await expect(luca.page.getByText("The team at Trattoria Sole: Yes, a public car park two minutes away")).toBeVisible({ timeout: 15_000 });
  await shop.page.goto("/business");
  await expect(shop.page.getByRole("region", { name: "Questions and answers" })).toContainText("Is there parking nearby?");
  await shop.close();
  await luca.close();
});

test("a business's permanent QR code: printable poster, and scanning it lets anyone ask the agent", async ({ browser, baseURL }) => {
  const shop = await as(browser, "trattoria");
  await shop.page.goto("/contacts");
  await shop.page.getByText("📷 Show my QR code").click();
  // Permanent: the plain business page, no expiring token.
  await expect(shop.page.getByTestId("qr-code")).toHaveAttribute("data-url", `${baseURL}/u/trattoria`);
  await shop.page.getByTestId("print-poster").click();
  await expect(shop.page.getByTestId("qr-poster")).toContainText("Scan to ask us anything");

  // A customer scans it: one tap opens a chat with the business's agent.
  const luca = await as(browser, "luca");
  await luca.page.goto("/u/trattoria");
  await luca.page.getByRole("button", { name: "💬 Ask us anything" }).click();
  await expect(luca.page).toHaveURL(/\/chats\/[0-9a-f-]+$/);
  await expect(luca.page.getByRole("heading", { name: /Trattoria Sole/ })).toBeVisible();
  await shop.close();
  await luca.close();
});
