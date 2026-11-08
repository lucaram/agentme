import { expect, test, type Browser, type Page } from "@playwright/test";

// Runs after agentme.spec.ts (same seeded database, one worker).
// Starting point: luca–marco, luca–paul, marco–paul, eve–paul are contacts; eve knows nobody else.

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

async function syncContacts(page: Page, text: string) {
  await page.goto("/discover");
  await page.getByText("…or paste emails and phone numbers").click();
  await page.getByLabel("Emails and phone numbers").fill(text);
  await page.getByRole("button", { name: "Find people" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Checked" })).toBeVisible();
}

test("people you know: only shown when both have each other", async ({ browser }) => {
  const eve = await as(browser, "eve");
  await syncContacts(eve.page, "Marco <marco@agentme.test>");
  await expect(eve.page.getByTestId("suggestion")).toHaveCount(0); // Marco doesn't have Eve (yet)

  const marco = await as(browser, "marco");
  await syncContacts(marco.page, "eve@agentme.test");
  await expect(marco.page.getByTestId("suggestion").filter({ hasText: "@eve" })).toBeVisible();
  await eve.page.reload();
  await expect(eve.page.getByTestId("suggestion").filter({ hasText: "@marco" })).toContainText("You're in each other's contacts");
  await eve.close();
  await marco.close();
});

test("scanning a live QR code connects instantly and opens the chat", async ({ browser }) => {
  const luca = await as(browser, "luca");
  await luca.page.goto("/contacts");
  await expect(luca.page.getByTestId("personal-link")).toHaveText(/\/u\/luca$/);
  await luca.page.getByText("📷 Show my QR code").click();
  const qr = luca.page.getByTestId("qr-code");
  await expect(qr.locator("svg")).toBeVisible();
  const url = await qr.getAttribute("data-url");

  const eve = await as(browser, "eve");
  await eve.page.goto(url!);
  await eve.page.getByRole("button", { name: "Connect now" }).click();
  await expect(eve.page).toHaveURL(/\/chats\/[0-9a-f-]+$/);
  await expect(eve.page.getByText("You connected in person. Say hi!")).toBeVisible();

  // The plain link (no live code) is only a request.
  const paul = await as(browser, "paul");
  await paul.page.goto("/u/eve");
  await expect(paul.page.getByText("You're already connected")).toBeVisible(); // eve–paul from the earlier test
  await luca.close();
  await eve.close();
  await paul.close();
});

test("an introduction connects two friends only when both say yes", async ({ browser }) => {
  const luca = await as(browser, "luca");
  await luca.page.goto("/chats");
  await luca.page.getByRole("link", { name: /My Agent/ }).click();
  await send(luca.page, "introduce @eve to @marco - you both love climbing");
  await expect(luca.page.getByText(/will each see your introduction in their Inbox/)).toBeVisible();

  const eve = await as(browser, "eve");
  await eve.page.goto("/inbox");
  const card = eve.page.getByTestId("inbox-item").filter({ hasText: "wants to introduce you to" });
  await expect(card).toContainText("you both love climbing");
  await card.getByRole("button", { name: "Connect with Marco" }).click();
  await expect(eve.page.getByText("You said yes")).toBeVisible();

  const marco = await as(browser, "marco");
  await marco.page.goto("/inbox");
  await marco.page.getByTestId("inbox-item").filter({ hasText: "wants to introduce you to" }).getByRole("button", { name: "Connect with Eve" }).click();
  await expect(marco.page).toHaveURL(/\/chats\/[0-9a-f-]+$/);
  await expect(marco.page.getByText("Luca introduced you. Say hi!")).toBeVisible();
  await expect(luca.page.getByText("accepted your introduction")).toBeVisible({ timeout: 15_000 });
  await luca.close();
  await eve.close();
  await marco.close();
});

test("an invite link lets someone without AGENTME join a plan as a guest", async ({ browser }) => {
  const luca = await as(browser, "luca");
  await luca.page.goto("/chats");
  await luca.page.getByRole("link", { name: /My Agent/ }).click();
  await send(luca.page, "Ask @marco to vote: pizza or sushi");
  const task = luca.page.getByRole("region", { name: "Agent task" }).last();
  await task.getByRole("button", { name: "Approve" }).click();
  await expect(task.getByTestId("task-status")).toHaveText("Waiting for people to answer");
  await luca.page.goto("/chats");
  // The newest poll group (groups start with 👥; My Agent's preview can also mention 📊).
  await luca.page.getByRole("link", { name: /^👥 📊/ }).first().click();
  await luca.page.getByRole("button", { name: "🔗 Invite by link" }).click();
  const url = await luca.page.getByTestId("invite-url").textContent();
  expect(url).toMatch(/\/join\/[\w-]{20,}$/);

  // A brand-new person, not logged in, opens the link from WhatsApp.
  const context = await browser.newContext();
  const guest = await context.newPage();
  await guest.goto(url!);
  await expect(guest.getByRole("heading", { name: /Which option do you prefer/ })).toBeVisible();
  await guest.getByLabel("Your name").fill("Gina");
  await guest.getByLabel("Your address").fill(`gina${Date.now().toString().slice(-6)}`);
  await guest.getByRole("button", { name: "Join as a guest" }).click();
  await expect(guest).toHaveURL(/\/chats\/[0-9a-f-]+$/);
  await expect(guest.getByTestId("guest-banner")).toBeVisible();
  const poll = guest.getByTestId("poll").last();
  await poll.getByRole("button", { name: "pizza" }).click();
  await expect(poll.getByTestId("poll-count-pizza")).toContainText("1 vote");

  await expect(luca.page.getByText("Gina joined with the invite link.")).toBeVisible({ timeout: 15_000 });
  await context.close();
  await luca.close();
});
