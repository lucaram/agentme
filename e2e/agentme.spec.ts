import { expect, test, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

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
  // Group members see the organiser's answer...
  await expect(shared.getByTestId("rsvps")).toContainText("@luca: ✅ in");
  await shared.getByRole("radio", { name: "I'm in" }).click();
  // A neutral event line, not a fake message from Marco.
  await expect(marco.page.getByText("Marco is in ✅")).toBeVisible();
  // ...and their own answer, immediately; it stays editable.
  await expect(shared.getByTestId("rsvps")).toContainText("@marco: ✅ in");
  await expect(shared.getByRole("radio", { name: /I'm in/ })).toHaveAttribute("aria-checked", "true");

  // Luca's page was opened with a full load (the Realtime auth race). It must update live.
  await luca.page.reload();
  const rsvps = luca.page.getByTestId("rsvps").last();
  await expect(rsvps).toContainText("@marco: ✅ in");
  await expect(rsvps).toContainText("@paul: ⏳ waiting");

  // Paul sees who said what in his chat list, then declines.
  const paul = await as(browser, "paul");
  await expect(paul.page.getByText("Marco is in ✅")).toBeVisible();
  await paul.page.getByRole("link", { name: /Dinner — Italian/ }).click();
  await paul.page.getByTestId("proposal").getByRole("radio", { name: "Can't make it" }).click();
  await expect(paul.page.getByText("Paul can't make it ❌")).toBeVisible();

  // ...and Luca sees it without refreshing.
  await expect(rsvps).toContainText("@paul: ❌ can't make it", { timeout: 10_000 });

  // RSVP v2: Paul changes his mind; everyone sees the change.
  await paul.page.getByTestId("proposal").getByRole("radio", { name: /I'm in/ }).click();
  await expect(paul.page.getByText("Paul changed their answer: is in ✅")).toBeVisible();
  await expect(rsvps).toContainText("@paul: ✅ in", { timeout: 10_000 });
  await paul.close();

  // Recall: Luca's own agent answers from his plans.
  await openMyAgent(luca.page);
  await send(luca.page, "What time did we agree for dinner?");
  await expect(luca.page.getByText(/Dinner — Italian: Saturday at 7:30 PM\. In: @luca, @marco, @paul/)).toBeVisible();

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

test("an agent asks its human when it may not share, and the plan continues with their answer", async ({ browser }) => {
  // Paul keeps his availability private: his agent can't answer by itself.
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: paulAgent } = await db.from("agents").select("id").eq("handle", "paul").single();
  const setPaul = (disclosure: "private" | "contacts") =>
    db.from("agent_facts").update({ disclosure }).eq("agent_id", paulAgent!.id).eq("category", "availability");
  await setPaul("private");

  try {
    const luca = await as(browser, "luca");
    await openMyAgent(luca.page);
    await send(luca.page, "Arrange drinks with @paul on Saturday evening");
    const task = luca.page.getByRole("region", { name: "Agent task" }).last();
    await task.getByRole("button", { name: "Approve" }).click();
    await expect(task.getByTestId("task-status")).toHaveText("Waiting for people to answer");
    await expect(task.getByTestId("exchange")).toContainText("asked @paul personally");

    // Paul sees it in his Inbox, prefilled from his own (private) info, and chooses to share.
    const paul = await as(browser, "paul");
    await expect(paul.page.getByTestId("inbox-badge")).toHaveText("1");
    await paul.page.getByRole("link", { name: /Inbox/ }).click();
    const item = paul.page.getByTestId("inbox-item");
    await expect(item).toContainText("@luca's agent");
    await expect(item.getByLabel("Availability")).toHaveValue("Saturdays after 6 PM");
    await item.getByRole("button", { name: "Share answer" }).click();
    await expect(paul.page.getByText("Nothing needs your answer right now.")).toBeVisible();

    // Luca's plan continues on its own, and shows that Paul answered personally.
    await expect(task.getByTestId("exchange")).toContainText("answered by @paul personally");
    await expect(luca.page.getByTestId("proposal").last()).toContainText("6:30 PM");
    await luca.close();
    await paul.close();
  } finally {
    await setPaul("contacts");
  }
});

test("a poll: the organiser approves fixed options, people vote, the app counts", async ({ browser }) => {
  const luca = await as(browser, "luca");
  await openMyAgent(luca.page);
  await send(luca.page, "Ask @marco and @paul to vote: Italian, Thai or Indian");
  const task = luca.page.getByRole("region", { name: "Agent task" }).last();
  await expect(task.getByTestId("poll-options")).toHaveText("Italian · Thai · Indian");
  await task.getByRole("button", { name: "Approve" }).click();
  await expect(task.getByTestId("task-status")).toHaveText("Waiting for people to answer");

  // Marco's own agent suggests from Marco's own food preferences; Marco decides.
  const marco = await as(browser, "marco");
  await marco.page.getByRole("link", { name: /Dinner — Italian/ }).click();
  const poll = marco.page.getByTestId("poll").last();
  await expect(poll.getByTestId("poll-suggestion")).toContainText("Your agent suggests Italian");
  await poll.getByRole("button", { name: "Italian" }).click();
  await expect(poll.getByTestId("poll-count-Italian")).toContainText("1 vote");

  const paul = await as(browser, "paul");
  await paul.page.getByRole("link", { name: /Dinner — Italian/ }).click();
  const paulPoll = paul.page.getByTestId("poll").last();
  await expect(paulPoll.getByTestId("poll-suggestion")).toHaveCount(0); // "Italian or Thai": ambiguous, no suggestion
  await paulPoll.getByRole("button", { name: "Thai" }).click();

  // Luca votes last: everyone has voted, so the app closes and announces the result.
  await luca.page.getByRole("link", { name: "Chats" }).click();
  await luca.page.getByRole("link", { name: /Dinner — Italian/ }).click();
  await luca.page.getByTestId("poll").last().getByRole("button", { name: "Italian" }).click();
  await expect(luca.page.getByText("Poll closed: “Which option do you prefer?” — Italian (2 of 3 votes).")).toBeVisible();
  await expect(marco.page.getByTestId("poll").last()).toContainText("Result: Italian", { timeout: 10_000 });
  await luca.close();
  await marco.close();
  await paul.close();
});

test("a question is answered personally and relayed to whoever asked", async ({ browser }) => {
  const luca = await as(browser, "luca");
  await openMyAgent(luca.page);
  await send(luca.page, "Ask @marco if he can help me move on Sunday");
  const task = luca.page.getByRole("region", { name: "Agent task" }).last();
  await expect(task).toContainText("“Can you help me move on Sunday?”");
  await task.getByRole("button", { name: "Approve" }).click();
  await expect(task.getByTestId("task-status")).toHaveText("Waiting for people to answer");

  const marco = await as(browser, "marco");
  await expect(marco.page.getByTestId("inbox-badge")).toHaveText("1");
  await marco.page.getByRole("link", { name: /Inbox/ }).click();
  const item = marco.page.getByTestId("inbox-item");
  await expect(item).toContainText("“Can you help me move on Sunday?”");
  await item.getByLabel("Your answer").fill("Yes, from 10am!");
  await item.getByRole("button", { name: "Reply" }).click();
  await expect(marco.page.getByText("Nothing needs your answer right now.")).toBeVisible();

  await expect(luca.page.getByText("💬 @marco answered personally: “Yes, from 10am!”")).toBeVisible();
  await expect(task.getByTestId("task-status")).toHaveText("Done");
  await luca.close();
  await marco.close();
});
