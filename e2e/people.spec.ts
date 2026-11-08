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

test("connecting contacts shows a list to tick: add who you want, invite the rest", async ({ browser }) => {
  // Development simulates the email provider: the demo accounts plus two people not on AGENTME.
  const marco = await as(browser, "marco");
  await marco.page.goto("/discover");
  await marco.page.getByRole("link", { name: "Connect", exact: true }).click();
  const list = marco.page.getByTestId("contact-list");
  await expect(list).toContainText("on AGENTME");

  // Existing contacts are marked; you only tick the ones you want.
  await expect(list.getByRole("listitem").filter({ hasText: "Luca (luca@agentme.test)" })).toContainText("✓ Contact");
  await list.getByLabel("Trattoria Sole (trattoria@agentme.test)").check();
  await list.getByRole("button", { name: "Add 1 selected" }).click();
  await expect(list.getByRole("status")).toContainText("Sent 1 contact request");
  await expect(list.getByRole("listitem").filter({ hasText: "Trattoria Sole" })).toContainText("Requested");

  // People not on AGENTME: an invite from your own email app.
  const invite = list.getByRole("listitem").filter({ hasText: "Anna Bianchi (anna.bianchi@example.com)" }).getByRole("link", { name: "Invite" });
  await expect(invite).toHaveAttribute("href", /^mailto:anna\.bianchi%40example\.com\?subject=Join%20me%20on%20AGENTME/);
  await expect(list).not.toContainText("marco@agentme.test"); // never yourself

  await list.getByRole("button", { name: "Done" }).click();
  await expect(marco.page.getByTestId("contact-list")).toHaveCount(0);
  await expect(marco.page.getByText("Last checked")).toBeVisible();
  await marco.close();
});

test("search in Chats finds your groups and contacts and opens them", async ({ browser }) => {
  const luca = await as(browser, "luca");
  const search = luca.page.getByRole("combobox", { name: "Search chats and contacts" });

  await search.fill("which option");
  await luca.page.getByRole("option").filter({ hasText: "Which option do you prefer?" }).first().click();
  await expect(luca.page.getByRole("heading", { name: /Which option do you prefer/ })).toBeVisible();

  await search.fill("pau");
  await luca.page.getByRole("option").filter({ hasText: "@paul" }).first().click();
  await expect(luca.page).toHaveURL(/\/chats\/[0-9a-f-]+$/);
  await expect(luca.page.getByRole("heading", { name: "Paul", exact: true })).toBeVisible();

  // Keyboard: type, Enter opens the first match.
  await search.fill("my agent");
  await expect(luca.page.getByRole("option").first()).toContainText("My Agent");
  await search.press("Enter");
  await expect(luca.page.getByRole("heading", { name: "My Agent" })).toBeVisible();
  await luca.close();
});
