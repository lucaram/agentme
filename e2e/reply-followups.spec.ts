import { expect, test, type Browser, type Page } from "@playwright/test";

// Two follow-ups to ↩ Reply:
//  - a plan asked for in a reply ("organise this") takes what is being organised from the quoted message;
//  - in My Agent, a quote chosen in one request doesn't ride along into another request.

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

async function send(page: Page, text: string) {
  await page.getByLabel("Message", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

test("↩ Reply + a plan: 'organise this' takes the event and the day from the quoted message", async ({ browser }) => {
  // A group of its own (the private card left here stays out of other tests' chats).
  const name = `Plans ${`${Date.now()}`.slice(-6)}`;
  const luca = await as(browser, "luca");
  await luca.page.getByRole("navigation").getByRole("link", { name: "Groups" }).click();
  await luca.page.getByRole("button", { name: "＋ New group" }).click();
  const form = luca.page.getByRole("form", { name: "New group" });
  await form.getByLabel("Group name").fill(name);
  await form.getByRole("combobox", { name: "Search contacts" }).fill("mar");
  await form.getByRole("option", { name: /Marco/ }).click();
  await form.getByRole("button", { name: "Create group" }).click();
  await expect(luca.page.getByRole("heading", { name })).toBeVisible();
  const chatUrl = luca.page.url().replace("/groups/", "/chats/");
  await luca.page.goto(chatUrl);
  const idea = "Dinner at the new place on Saturday evening, who's up for it";
  await send(luca.page, idea);
  await expect(luca.page.getByRole("listitem").filter({ hasText: idea })).toBeVisible();

  // Marco replies to it and asks his agent to organise "this": the plan is about the dinner on Saturday evening.
  const marco = await as(browser, "marco");
  await marco.page.goto(chatUrl);
  const original = marco.page.getByRole("listitem").filter({ hasText: idea }).first();
  await original.getByLabel("Message options").click();
  await original.getByRole("button", { name: "↩ Reply" }).click();
  await expect(marco.page.getByTestId("replying-to")).toContainText("Replying to Luca");
  await send(marco.page, "@agent organise this");
  const task = marco.page.getByRole("region", { name: "Agent task" }).last();
  await expect(task.getByTestId("task-status")).toHaveText("Waiting for your approval", { timeout: 15_000 });
  await expect(task).toContainText(/dinner/i);
  await expect(task).toContainText(/Saturday evening/i);
  // Nothing is sent until he approves: Luca sees no card.
  await expect(luca.page.getByRole("region", { name: "Agent task" })).toHaveCount(0);
  await luca.close();
  await marco.close();
});

test("My Agent: a quote chosen in one request doesn't carry into another request", async ({ browser }) => {
  const eve = await as(browser, "eve");
  await eve.page.goto("/chats");
  await eve.page.getByRole("link", { name: /My Agent/ }).click();
  await expect(eve.page.getByRole("heading", { name: "My Agent" })).toBeVisible();

  // Request A: she starts replying to her own message there.
  const first = `first request ${Date.now()}`;
  await send(eve.page, first);
  await expect(eve.page).toHaveURL(/[?&]t=[0-9a-f-]{36}/, { timeout: 15_000 });
  const message = eve.page.getByRole("listitem").filter({ hasText: first }).first();
  await expect(message).toBeVisible();
  await message.getByLabel("Message options").click();
  await message.getByRole("button", { name: "↩ Reply" }).click();
  await expect(eve.page.getByTestId("replying-to")).toBeVisible();

  // Back to the list of requests and on to a new one: the quote stays behind.
  await eve.page.getByTestId("back-to-my-agent").click();
  await expect(eve.page.getByRole("heading", { name: "My Agent" })).toBeVisible();
  await expect(eve.page).not.toHaveURL(/[?&]t=/);
  await expect(eve.page.getByTestId("replying-to")).toHaveCount(0);
  const second = `second request ${Date.now()}`;
  await send(eve.page, second);
  await expect(eve.page.getByRole("listitem").filter({ hasText: second }).first()).toBeVisible({ timeout: 15_000 });
  await expect(eve.page.getByTestId("quote")).toHaveCount(0);
  await expect(eve.page.getByText(first)).toHaveCount(0);
  await eve.close();
});
