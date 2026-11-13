import { expect, test, type Browser, type Page } from "@playwright/test";

// Research: your agent looks up public facts and shows where they came from; inside a
// chat with people it only ever prepares a private draft that you send yourself.
// (The test stand-in for the web answers the weather, with a source, and nothing else.)

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

test("My Agent looks up a public fact and answers with its source; what it can't verify it doesn't guess", async ({ browser }) => {
  const paul = await as(browser, "paul");
  await paul.page.goto("/chats");
  await paul.page.getByRole("link", { name: /My Agent/ }).click();
  await expect(paul.page.getByRole("heading", { name: "My Agent" })).toBeVisible();

  await send(paul.page, "What's the weather in Falkirk?");
  await expect(paul.page.getByText("In Falkirk it's 12°C with light rain right now.")).toBeVisible({ timeout: 15_000 });
  const source = paul.page.getByTestId("sources").last().getByRole("link");
  await expect(source).toContainText("Falkirk weather (demo)");
  await expect(source).toHaveAttribute("href", "https://weather.example/falkirk");

  // Nothing found: it says so instead of answering from memory.
  await send(paul.page, "What's the latest score of the Falkirk match?");
  await expect(paul.page.getByText("I couldn't find a reliable source for that.")).toBeVisible({ timeout: 15_000 });
  await paul.close();
});

test("no place named: your agent uses the town where you usually are, and asks when it doesn't know it", async ({ browser }) => {
  // Marco's profile says "Lives in Islington" (private): only the town goes with the look-up.
  const marco = await as(browser, "marco");
  await marco.page.goto("/chats");
  await marco.page.getByRole("link", { name: /My Agent/ }).click();
  await send(marco.page, "What's the weather?");
  await expect(marco.page.getByText("📍 For Islington, where you usually are.")).toBeVisible({ timeout: 15_000 });
  await expect(marco.page.getByText("In Islington it's 12°C with light rain right now.")).toBeVisible();

  // He can turn it off: then his agent asks which place.
  await marco.page.goto("/settings/privacy");
  await marco.page.getByLabel("Use my town for look-ups").uncheck();
  await marco.page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(marco.page).toHaveURL(/saved=1/);
  await marco.page.goto("/settings/privacy");
  await expect(marco.page.getByLabel("Use my town for look-ups")).not.toBeChecked();
  await marco.page.goto("/chats");
  await marco.page.getByRole("link", { name: /My Agent/ }).click();
  await send(marco.page, "What's the weather?");
  await expect(marco.page.getByText(/Which place do you mean\?/)).toBeVisible({ timeout: 15_000 });
  // Back on for the other tests.
  await marco.page.goto("/settings/privacy");
  await marco.page.getByLabel("Use my town for look-ups").check();
  await marco.page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(marco.page).toHaveURL(/saved=1/);
  await marco.close();
});

test("📍 Near me now: where you are is used for one message, as a town, and then forgotten", async ({ browser }) => {
  // Paul has no usual place saved. His browser says he's in Falkirk.
  const context = await browser.newContext({ geolocation: { latitude: 56.0019, longitude: -3.7839 }, permissions: ["geolocation"] });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill("paul@agentme.test");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/chats/);
  await page.getByRole("link", { name: /My Agent/ }).click();
  await expect(page.getByRole("heading", { name: "My Agent" })).toBeVisible();

  await page.getByRole("button", { name: "Near me now" }).click();
  await expect(page.getByTestId("near-me")).toContainText("for this message only");
  await send(page, "What's the weather?");
  await expect(page.getByText("📍 For Falkirk, United Kingdom, where you are now.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("In Falkirk it's 12°C with light rain right now.")).toBeVisible();
  // One message only: the next one doesn't carry it.
  await expect(page.getByTestId("near-me")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Near me now" })).toHaveAttribute("aria-pressed", "false");
  await context.close();
});

test("↩ Reply + @agent look-up: the quoted message completes the question, and you see what was searched", async ({ browser }) => {
  const walk = `Anyone fancy a walk in Falkirk on Sunday? (${Date.now()})`;
  // A group of its own, so the private messages left here don't show up in other tests' chats.
  const name = `Walk ${`${Date.now()}`.slice(-6)}`;
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
  await send(luca.page, walk);
  await expect(luca.page.getByRole("listitem").filter({ hasText: walk })).toBeVisible();

  // Marco replies to it and asks his agent, without naming the place: it comes from the quoted message
  // (not from where he usually is), and he is shown the question that went to the search.
  const marco = await as(browser, "marco");
  await marco.page.goto(chatUrl);
  const original = marco.page.getByRole("listitem").filter({ hasText: walk }).first();
  await original.getByLabel("Message options").click();
  await original.getByRole("button", { name: "↩ Reply" }).click();
  await expect(marco.page.getByTestId("replying-to")).toContainText("Replying to Luca");
  await send(marco.page, "@agent what's the weather like?");
  const answer = marco.page.getByTestId("private-message").filter({ hasText: "Looked up:" }).last();
  await expect(answer).toContainText("🔎 Looked up: what's the weather like? (about: Anyone fancy a walk in Falkirk on Sunday?", { timeout: 15_000 });
  await expect(answer).toContainText("In Falkirk it's 12°C with light rain right now.");
  await expect(answer).not.toContainText("Islington");
  // Still only a private draft: Luca sees nothing of it.
  await expect(luca.page.getByText(/Looked up:/)).toHaveCount(0);
  await luca.close();
  await marco.close();
});

test("@agent 'summarise' or 'answer' about something else is looked up, not taken as a command about the chat", async ({ browser }) => {
  // A group of its own (the private messages left here stay out of other tests' chats).
  const name = `Words ${`${Date.now()}`.slice(-6)}`;
  const luca = await as(browser, "luca");
  await luca.page.getByRole("navigation").getByRole("link", { name: "Groups" }).click();
  await luca.page.getByRole("button", { name: "＋ New group" }).click();
  const form = luca.page.getByRole("form", { name: "New group" });
  await form.getByLabel("Group name").fill(name);
  await form.getByRole("combobox", { name: "Search contacts" }).fill("mar");
  await form.getByRole("option", { name: /Marco/ }).click();
  await form.getByRole("button", { name: "Create group" }).click();
  await expect(luca.page.getByRole("heading", { name })).toBeVisible();
  await luca.page.goto(luca.page.url().replace("/groups/", "/chats/"));

  // "summarise … the weather in Miami" is about Miami, not about this chat.
  await send(luca.page, "@agent summarise very concisely the weather in Miami");
  const first = luca.page.getByRole("form", { name: "Draft reply" }).last();
  await expect(first.getByLabel("Edit draft")).toHaveValue(/^In Miami it's 12°C with light rain right now\./, { timeout: 15_000 });
  await expect(luca.page.getByTestId("private-message").filter({ hasText: "📝 Summary" })).toHaveCount(0);

  // "answer <a question about public facts>" is looked up too, not made up as a chatty reply.
  await send(luca.page, "@agent answer what's the weather in Leith");
  await expect(luca.page.getByRole("form", { name: "Draft reply" }).last().getByLabel("Edit draft")).toHaveValue(/^In Leith it's 12°C with light rain right now\./, { timeout: 15_000 });

  // And "summarise" on its own still summarises this chat.
  await send(luca.page, "@agent summarise");
  await expect(luca.page.getByTestId("private-message").filter({ hasText: "📝 Summary" })).toBeVisible({ timeout: 15_000 });
  await luca.close();
});

test("@agent inside a message: your own words plus what it found, as a private draft you send once", async ({ browser }) => {
  const luca = await as(browser, "luca");
  await luca.page.getByRole("link", { name: /^👥 Dinner — Italian/ }).click();
  const marco = await as(browser, "marco");
  await marco.page.getByRole("link", { name: /^👥 Dinner — Italian/ }).click();

  await send(luca.page, "I'm fine thanks. @agent: what's the weather in Falkirk?");
  const draft = luca.page.getByRole("form", { name: "Draft reply" }).last();
  await expect(draft.getByLabel("Edit draft")).toHaveValue(/^I'm fine thanks\. In Falkirk it's 12°C with light rain right now\.\n\(Source: https:\/\/weather\.example\/falkirk\)$/, { timeout: 15_000 });
  await expect(luca.page.getByTestId("sources").last().getByRole("link")).toHaveAttribute("href", "https://weather.example/falkirk");
  // Nothing has been posted: not his words, not the answer.
  await expect(marco.page.getByText(/I'm fine thanks/)).toHaveCount(0);
  await expect(marco.page.getByTestId("private-message")).toHaveCount(0);

  // He edits it and sends it as himself: one message, in his name.
  await draft.getByLabel("Edit draft").fill("I'm fine thanks. In Falkirk it's 12°C with light rain right now.");
  await draft.getByRole("button", { name: "Send as me" }).click();
  await expect(luca.page.getByText("Sent ✓").last()).toBeVisible({ timeout: 10_000 });
  const sent = marco.page.getByRole("listitem").filter({ hasText: "I'm fine thanks. In Falkirk it's 12°C" });
  await expect(sent).toHaveCount(1, { timeout: 10_000 });
  await expect(sent.getByTitle("Written by an AI agent")).toHaveCount(0);
  await luca.close();
  await marco.close();
});
