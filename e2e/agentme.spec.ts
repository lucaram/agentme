import { expect, test, type Browser, type Page } from "@playwright/test";

const PASSWORD = "password123";

async function login(page: Page, handle: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(`${handle}@agentme.test`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/chats/);
}

async function as(browser: Browser, handle: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, handle);
  return { page, close: () => context.close() };
}

async function openMyAgent(page: Page) {
  await page.goto("/chats");
  await page.getByRole("link", { name: /My Agent/ }).click();
  await expect(page.getByRole("heading", { name: "My Agent" })).toBeVisible();
}

async function send(page: Page, text: string) {
  await page.getByLabel("Message", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

test("a new user creates a working agent in under 60 seconds", async ({ page }) => {
  const started = Date.now();
  const id = `${Date.now()}`.slice(-8);
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`new${id}@agentme.test`);
  await page.getByLabel("Password").fill("a-good-password");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Create your agent" })).toBeVisible();
  await page.getByLabel("Your name").fill("Nadia");
  await page.getByLabel("Agent address").fill(`nadia${id}`);
  await expect(page.getByText(`@nadia${id} is available.`)).toBeVisible();
  await page.getByRole("button", { name: "Create my agent" }).click();

  await expect(page.getByText(`I'm @nadia${id}, your agent`)).toBeVisible();
  expect(Date.now() - started).toBeLessThan(60_000);
});

test("three agents coordinate a dinner and humans approve it", async ({ browser }) => {
  const luca = await as(browser, "luca");
  await openMyAgent(luca.page);
  await send(luca.page, "Arrange dinner with @marco and @paul on Saturday evening");

  const task = luca.page.getByRole("region", { name: "Agent task" }).last();
  await expect(task.getByTestId("task-status")).toHaveText("Waiting for your approval");
  await expect(task).toContainText("@marco, @paul");
  await task.getByRole("button", { name: "Approve" }).click();

  // Agents talk over A2A; progress and the proposal stream in via Realtime.
  const proposal = luca.page.getByTestId("proposal").last();
  await expect(proposal).toContainText("Saturday, 7:30 PM", { timeout: 45_000 });
  await expect(proposal).toContainText("Italian");
  await expect(proposal).toContainText("no reservation has been made");
  await expect(task.getByTestId("exchange")).toHaveCount(2);
  await expect(task).not.toContainText("knee surgery");
  await proposal.getByRole("button", { name: "Share with everyone" }).click();
  await expect(luca.page.getByText("Shared the plan with everyone")).toBeVisible();

  // Marco sees the plan in a new group and accepts.
  const marco = await as(browser, "marco");
  await marco.page.getByRole("link", { name: /Dinner — Italian/ }).click();
  const shared = marco.page.getByTestId("proposal");
  await expect(shared).toContainText("7:30 PM");
  await shared.getByRole("button", { name: "I'm in" }).click();
  await expect(marco.page.getByText("✅ I'm in.")).toBeVisible();

  // Luca's page was opened with a full load (the Realtime auth race). It must update live.
  await luca.page.reload();
  const rsvps = luca.page.getByTestId("rsvps").last();
  await expect(rsvps).toContainText("@marco: ✅ in");
  await expect(rsvps).toContainText("@paul: ⏳ waiting");

  // Paul sees who said what in his chat list, then declines.
  const paul = await as(browser, "paul");
  await expect(paul.page.getByText("Marco: ✅ I'm in.")).toBeVisible();
  await paul.page.getByRole("link", { name: /Dinner — Italian/ }).click();
  await paul.page.getByTestId("proposal").getByRole("button", { name: "Can't make it" }).click();
  await expect(paul.page.getByText("❌ I can't make it.")).toBeVisible();

  // ...and Luca sees it without refreshing.
  await expect(rsvps).toContainText("@paul: ❌ can't make it", { timeout: 10_000 });
  await paul.close();

  // Luca can see what the coordination cost in AI calls (all agents' calls count).
  await luca.page.goto("/history");
  await expect(luca.page.getByTestId("task-history").first()).toContainText(/AI: \d+ calls/);
  await expect(luca.page.getByTestId("usage-total")).toBeVisible();

  // Marco can audit exactly what his agent shared, and with whom.
  await marco.page.goto("/history");
  const disclosure = marco.page.getByTestId("disclosure").first();
  await expect(disclosure).toContainText("@luca's agent");
  await expect(disclosure).toContainText("Shared: Availability, Food preferences");

  await luca.close();
  await marco.close();
});

test("agents refuse to coordinate with non-contacts", async ({ browser }) => {
  const luca = await as(browser, "luca");
  await openMyAgent(luca.page);
  await send(luca.page, "Arrange coffee with @eve tomorrow morning");
  await expect(luca.page.getByText("@eve isn't a contact yet")).toBeVisible();
  await luca.close();
});

test("the owner can cancel a task before anything is sent", async ({ browser }) => {
  const luca = await as(browser, "luca");
  await openMyAgent(luca.page);
  await send(luca.page, "Plan lunch with @paul on Sunday");
  const task = luca.page.getByRole("region", { name: "Agent task" }).last();
  await expect(task.getByTestId("task-status")).toHaveText("Waiting for your approval");
  await task.getByRole("button", { name: "Cancel" }).click();
  await expect(task.getByTestId("task-status")).toHaveText("Stopped");
  await expect(task.getByTestId("exchange")).toHaveCount(0);
  await luca.close();
});

test("contact request, accept and direct message", async ({ browser }) => {
  const eve = await as(browser, "eve");
  await eve.page.goto("/discover?q=paul");
  await eve.page.getByRole("button", { name: "Add contact" }).click();
  await expect(eve.page.getByText("Requested")).toBeVisible();

  const paul = await as(browser, "paul");
  await paul.page.goto("/contacts");
  await paul.page.getByRole("button", { name: "Accept" }).click();
  await paul.page.getByRole("listitem").filter({ hasText: "@eve" }).getByRole("button", { name: "Message" }).click();
  await send(paul.page, "Hi Eve, welcome!");
  await expect(paul.page.getByText("Hi Eve, welcome!")).toBeVisible();

  await eve.page.goto("/chats");
  await expect(eve.page.getByText("Hi Eve, welcome!")).toBeVisible();
  await eve.close();
  await paul.close();
});

test("a business agent answers questions over A2A without taking bookings", async ({ browser }) => {
  const luca = await as(browser, "luca");
  await luca.page.goto("/discover?q=tratt");
  await luca.page.getByRole("button", { name: "Ask agent" }).click();
  await expect(luca.page.getByRole("heading", { name: /Trattoria Sole/ })).toBeVisible();
  await send(luca.page, "Is there step-free access?");
  await expect(luca.page.getByText("step-free entrance")).toBeVisible();
  await send(luca.page, "Can you book a table for 4 tonight?");
  await expect(luca.page.getByText(/can't take bookings/)).toBeVisible();
  await expect(luca.page.getByTitle("Written by an AI agent").first()).toBeVisible();
  await luca.close();
});
