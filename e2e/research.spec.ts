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
  await page.getByRole("button", { name: "Send" }).click();
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
