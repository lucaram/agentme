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

  // WhatsApp-style unread counters: on the chat and on the Chats tab...
  const row = eve.page.getByRole("link", { name: /^🦉 Paul/ });
  await expect(row.getByTestId("unread-badge")).toHaveText("1");
  // The tab shows the total across chats (it may include other unread chats, e.g. her agent's welcome).
  const total = async () => {
    const badge = eve.page.getByTestId("chats-badge");
    return (await badge.count()) ? Number(await badge.textContent()) : 0;
  };
  const before = await total();
  expect(before).toBeGreaterThanOrEqual(1);
  // ...live, when another message arrives...
  await send(paul.page, "Are you coming on Saturday?");
  await expect(row.getByTestId("unread-badge")).toHaveText("2", { timeout: 10_000 });
  await expect(eve.page.getByTestId("chats-badge")).toHaveText(String(before + 1));
  // ...and cleared by opening the chat. Paul's own view never counts his messages.
  await row.click();
  // Wait until the chat is really open: the message text is also on the list as the preview.
  await expect(eve.page).toHaveURL(/\/chats\/[0-9a-f-]+$/);
  await expect(eve.page.getByRole("heading", { name: /Paul/ })).toBeVisible();
  await eve.page.getByRole("link", { name: "Chats" }).click();
  await expect(row.getByTestId("unread-badge")).toHaveCount(0);
  // Reading the chat removes exactly its 2 messages from the total.
  await expect.poll(total).toBe(before - 1);

  // Leaving tells the others, with a date and time like every system note.
  await row.click();
  await expect(eve.page).toHaveURL(/\/chats\/[0-9a-f-]+$/);
  await eve.page.getByRole("button", { name: "Leave" }).click();
  await expect(eve.page).toHaveURL(/\/chats$/);
  await expect(paul.page.getByTestId("system-note").filter({ hasText: "Eve left the chat." })).toHaveText(/^\d{2} [A-Z][a-z]{2}, \d{2}:\d{2} - Eve left the chat\.$/);
  // The DM keeps her name (it would otherwise go blank) and is closed for sending.
  await expect(paul.page.getByRole("heading", { name: "Eve (left)" })).toBeVisible();
  await expect(paul.page.getByTestId("dm-closed")).toBeVisible();
  await expect(paul.page.getByLabel("Message", { exact: true })).toHaveCount(0);
  await paul.page.goto("/chats");
  await expect(paul.page.getByRole("link", { name: /Eve \(left\)/ })).toBeVisible();
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
    await expect(task.getByTestId("task-status")).toHaveText("Waiting for @paul to answer");
    await expect(task.getByTestId("exchange")).toContainText("asked @paul personally");

    // Paul's agent tells him in My Agent (unread), where it waits under "Needs your answer",
    // prefilled from his own (private) info; he chooses to share.
    const paul = await as(browser, "paul");
    const myAgent = paul.page.getByRole("link", { name: /My Agent/ });
    await expect(myAgent.getByTestId("unread-badge")).toBeVisible();
    await myAgent.click();
    await expect(paul.page.getByTestId("open-requests")).toContainText("Needs your answer");
    const item = paul.page.getByTestId("inbox-item");
    await expect(item).toContainText("@luca's agent");
    await expect(item.getByLabel("Availability")).toHaveValue("Saturdays after 6 PM");
    await item.getByRole("button", { name: "Share answer" }).click();
    await expect(paul.page.getByTestId("inbox-item")).toHaveCount(0);
    await expect(paul.page.getByText(/I sent your answer/)).toBeVisible();

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
  // Each plan gets its own group, named after it.
  const marco = await as(browser, "marco");
  await marco.page.getByRole("link", { name: /^👥 📊 Which option do you prefer\?/ }).click();
  const poll = marco.page.getByTestId("poll").last();
  await expect(poll.getByTestId("poll-suggestion")).toContainText("Your agent suggests Italian");
  await poll.getByRole("button", { name: "Italian" }).click();
  await expect(poll.getByTestId("poll-count-Italian")).toContainText("1 vote");

  const paul = await as(browser, "paul");
  await paul.page.getByRole("link", { name: /^👥 📊 Which option do you prefer\?/ }).click();
  const paulPoll = paul.page.getByTestId("poll").last();
  await expect(paulPoll.getByTestId("poll-suggestion")).toHaveCount(0); // "Italian or Thai": ambiguous, no suggestion
  await paulPoll.getByRole("button", { name: "Thai" }).click();

  // Luca votes last: everyone has voted, so the app closes and announces the result.
  await luca.page.getByRole("link", { name: "Chats" }).click();
  await luca.page.getByRole("link", { name: /^👥 📊 Which option do you prefer\?/ }).click();
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
  await expect(task.getByTestId("task-status")).toHaveText("Waiting for @marco to answer");

  const marco = await as(browser, "marco");
  await marco.page.getByRole("link", { name: /My Agent/ }).click();
  const item = marco.page.getByTestId("inbox-item");
  await expect(item).toContainText("“Can you help me move on Sunday?”");
  await item.getByLabel("Your answer").fill("Yes, from 10am!");
  await item.getByRole("button", { name: "Reply" }).click();
  await expect(marco.page.getByTestId("inbox-item")).toHaveCount(0);

  await expect(luca.page.getByText("💬 @marco answered personally: “Yes, from 10am!”")).toBeVisible();
  await expect(task.getByTestId("task-status")).toHaveText("Done");
  await luca.close();
  await marco.close();
});

test("an invitation with a waitlist, then the organiser changes the time", async ({ browser }) => {
  const luca = await as(browser, "luca");
  await openMyAgent(luca.page);
  await send(luca.page, "Organise five-a-side on Thursday at 7pm with @marco and @paul, max 2");
  const task = luca.page.getByRole("region", { name: "Agent task" }).last();
  await expect(task.getByTestId("rsvp-limits")).toHaveText("max 2 (then a waitlist)");
  await task.getByRole("button", { name: "Approve" }).click();
  await expect(luca.page.getByText(/I've invited everyone in a new group, “Five-a-side”/)).toBeVisible();

  // Luca is in automatically; Marco takes the last place; Paul goes on the waitlist.
  const marco = await as(browser, "marco");
  await marco.page.getByRole("link", { name: /^👥 Five-a-side/ }).click();
  await marco.page.getByTestId("proposal").getByRole("radio", { name: "I'm in" }).click();
  await expect(marco.page.getByText("Marco is in ✅")).toBeVisible();
  const paul = await as(browser, "paul");
  await paul.page.getByRole("link", { name: /^👥 Five-a-side/ }).click();
  await paul.page.getByTestId("proposal").getByRole("radio", { name: "I'm in" }).click();
  await expect(paul.page.getByText("Paul is on the waitlist (#1) — the plan is full (2 max).")).toBeVisible();
  await expect(paul.page.getByTestId("rsvps")).toContainText("@paul: 🕒 waitlist #1");

  // Marco drops out: Paul moves up automatically.
  await marco.page.getByTestId("proposal").getByRole("radio", { name: "Can't make it" }).click();
  await expect(paul.page.getByText("Paul moved up from the waitlist: is in ✅")).toBeVisible({ timeout: 10_000 });

  // Change: the organiser moves it to 8pm; everyone else is asked to confirm again.
  await luca.page.getByRole("link", { name: "Chats" }).click();
  await luca.page.getByRole("link", { name: /^👥 Five-a-side/ }).click();
  const plan = luca.page.getByTestId("proposal");
  await plan.getByRole("button", { name: "Change plan" }).click();
  await plan.getByLabel("Time").fill("20:00");
  await plan.getByRole("button", { name: "Save change" }).click();
  await expect(luca.page.getByText("Luca changed the plan: Five-a-side, Thursday at 8:00 PM (was Thursday at 7:00 PM). Please confirm again.")).toBeVisible();
  await expect(paul.page.getByTestId("plan-when")).toContainText("8:00 PM", { timeout: 10_000 });
  await expect(paul.page.getByTestId("rsvps")).toContainText("@paul: ⏳ waiting");
  await expect(paul.page.getByTestId("rsvps")).toContainText("@luca: ✅ in");
  await luca.close();
  await marco.close();
  await paul.close();
});

test("a sign-up list: everyone claims their own items until everything is covered", async ({ browser }) => {
  const luca = await as(browser, "luca");
  await openMyAgent(luca.page);
  await send(luca.page, "Ask @marco and @paul who brings what for Saturday: drinks, dessert and bread");
  const task = luca.page.getByRole("region", { name: "Agent task" }).last();
  await expect(task.getByTestId("assign-items")).toHaveText("drinks · dessert · bread");
  await task.getByRole("button", { name: "Approve" }).click();

  const marco = await as(browser, "marco");
  await marco.page.getByRole("link", { name: /^👥 🧺 Who brings what/ }).click();
  await marco.page.getByTestId("item-drinks").getByRole("button", { name: "I'll take it" }).click();
  await expect(marco.page.getByTestId("item-drinks")).toContainText("you");

  const paul = await as(browser, "paul");
  await paul.page.getByRole("link", { name: /^👥 🧺 Who brings what/ }).click();
  await expect(paul.page.getByTestId("item-drinks")).toContainText("@marco");
  await expect(paul.page.getByTestId("item-drinks").getByRole("button")).toHaveCount(0); // can't take someone else's item
  await paul.page.getByTestId("item-dessert").getByRole("button", { name: "I'll take it" }).click();

  await luca.page.getByRole("link", { name: "Chats" }).click();
  await luca.page.getByRole("link", { name: /^👥 🧺 Who brings what/ }).click();
  await luca.page.getByTestId("item-bread").getByRole("button", { name: "I'll take it" }).click();
  await expect(luca.page.getByTestId("assign-progress")).toContainText("Everything is covered ✅");
  await expect(marco.page.getByText("Everything is covered ✅").first()).toBeVisible({ timeout: 10_000 });
  await luca.close();
  await marco.close();
  await paul.close();
});

test("an announcement is sent with the organiser's exact words, as their own message", async ({ browser }) => {
  const luca = await as(browser, "luca");
  await openMyAgent(luca.page);
  await send(luca.page, "Tell @marco and @paul: the trip is tomorrow, bring lunch");
  const task = luca.page.getByRole("region", { name: "Agent task" }).last();
  await expect(task).toContainText("“the trip is tomorrow, bring lunch”");
  await task.getByRole("button", { name: "Approve" }).click();

  const marco = await as(browser, "marco");
  await marco.page.getByRole("link", { name: /^👥 📣 the trip is tomorrow/ }).click();
  const message = marco.page.getByRole("listitem").filter({ hasText: "the trip is tomorrow, bring lunch" });
  await expect(message).toContainText("Luca");
  await expect(message.getByTitle("Written by an AI agent")).toHaveCount(0); // the organiser's own words, not AI
  await luca.close();
  await marco.close();
});

test("the composer: a template becomes an editable plan of blocks, run in one group", async ({ browser }) => {
  const luca = await as(browser, "luca");
  await openMyAgent(luca.page);
  // Template chips are filled with Luca's own contacts (after a few requests they sit behind 💡 Ideas).
  const ideas = luca.page.getByRole("button", { name: "💡 Ideas" });
  if (await ideas.count()) await ideas.click();
  await luca.page.getByRole("button", { name: "📊 Polls" }).click();
  await expect(luca.page.getByLabel("Message", { exact: true })).toHaveValue(/^Ask @\w+ and @\w+ to vote: /);
  // A combined plan typed by hand: an invitation plus a sign-up list.
  await luca.page.getByLabel("Message", { exact: true }).fill("Organise five-a-side on Thursday at 7pm with @marco and @paul, need 3, someone bring a ball and bibs");
  await luca.page.getByRole("button", { name: "Send" }).click();

  // The preview shows each block before anything is sent.
  const task = luca.page.getByRole("region", { name: "Agent task" }).last();
  await expect(task.getByTestId("step-rsvp")).toContainText("Five-a-side, Thursday at 7:00 PM");
  await expect(task.getByTestId("assign-items")).toHaveText("ball · bibs");

  // Edit it before approving.
  await task.getByRole("button", { name: "Edit plan" }).click();
  const editor = task.getByRole("form", { name: "Edit plan" });
  await editor.getByTestId("edit-rsvp").getByLabel("Event").fill("Thursday football");
  await editor.getByTestId("edit-assign").getByLabel(/Items/).fill("ball, bibs, water");
  await editor.getByRole("button", { name: "Save plan" }).click();
  await expect(task.getByTestId("assign-items")).toHaveText("ball · bibs · water");
  await expect(task.getByTestId("step-rsvp")).toContainText("Thursday football");
  await task.getByRole("button", { name: "Approve" }).click();

  // Marco gets the invitation and the sign-up list in the same new group.
  const marco = await as(browser, "marco");
  await marco.page.getByRole("link", { name: /^👥 Thursday football/ }).click();
  await expect(marco.page.getByTestId("proposal")).toContainText("Thursday football");
  await expect(marco.page.getByTestId("assign")).toContainText("water");
  await luca.close();
  await marco.close();
});

test("@agent in a group: private answers, a poll posted into the chat, a draft sent as me", async ({ browser }) => {
  const luca = await as(browser, "luca");
  await luca.page.getByRole("link", { name: /^👥 Dinner — Italian/ }).click();

  // Private summary: only Luca sees the command and the answer.
  await send(luca.page, "@agent summarise");
  await expect(luca.page.getByTestId("private-message").filter({ hasText: "📝" })).toBeVisible();
  const marco = await as(browser, "marco");
  await marco.page.getByRole("link", { name: /^👥 Dinner — Italian/ }).click();
  await expect(marco.page.getByText("@agent summarise")).toHaveCount(0);
  await expect(marco.page.getByTestId("private-message")).toHaveCount(0);

  // A poll with the chat's members: the approval card is private, the poll is posted here.
  await send(luca.page, "@agent poll: pizza or sushi?");
  const task = luca.page.getByRole("region", { name: "Agent task" }).last();
  await expect(task.getByTestId("poll-options")).toHaveText("pizza · sushi");
  await expect(marco.page.getByRole("region", { name: "Agent task" })).toHaveCount(0);
  await task.getByRole("button", { name: "Approve" }).click();
  await expect(marco.page.getByTestId("poll").last()).toContainText("pizza", { timeout: 15_000 });

  // A draft reply: private until Luca taps "Send as me".
  await send(luca.page, "@agent draft say I'm in");
  const draft = luca.page.getByRole("form", { name: "Draft reply" }).last();
  await expect(draft.getByLabel("Edit draft")).toHaveValue("Sounds good — say I'm in");
  await expect(marco.page.getByText("Sounds good — say I'm in")).toHaveCount(0);
  await draft.getByRole("button", { name: "Send as me" }).click();
  const sent = marco.page.getByRole("listitem").filter({ hasText: "Sounds good — say I'm in" });
  await expect(sent).toBeVisible({ timeout: 10_000 });
  await expect(sent.getByTitle("Written by an AI agent")).toHaveCount(0); // Luca sent it as himself
  await luca.close();
  await marco.close();
});

test("My Agent: one thread per request; an update brings it back with a badge, and it shows only its own messages", async ({ browser }) => {
  const luca = await as(browser, "luca");
  await openMyAgent(luca.page);
  await send(luca.page, "Ask @marco if he can lend me a ladder on Saturday");
  const task = luca.page.getByRole("region", { name: "Agent task" }).last();
  await task.getByRole("button", { name: "Approve" }).click();
  await expect(task.getByTestId("task-status")).toHaveText("Waiting for @marco to answer");

  // A second request starts its own thread: the first one's messages aren't there.
  await luca.page.getByTestId("back-to-my-agent").click();
  await expect(luca.page.getByRole("heading", { name: "My Agent" })).toBeVisible(); // the list, not the thread
  await send(luca.page, "Plan lunch with @paul on Sunday");
  await expect(luca.page.getByRole("region", { name: "Agent task" }).last()).toContainText("@paul");
  await expect(luca.page.getByText(/ladder/)).toHaveCount(0);
  await luca.page.getByTestId("back-to-my-agent").click();
  await expect(luca.page.getByRole("heading", { name: "My Agent" })).toBeVisible(); // the list, not the thread
  await expect(luca.page.getByRole("region", { name: "Needs you" }).getByTestId("agent-thread")).not.toHaveCount(0);

  // Marco answers: Luca's ladder request comes back with a badge.
  const marco = await as(browser, "marco");
  await marco.page.getByRole("link", { name: /My Agent/ }).click();
  const item = marco.page.getByTestId("inbox-item").filter({ hasText: "ladder" });
  await item.getByLabel("Your answer").fill("Yes, it's in the shed");
  await item.getByRole("button", { name: "Reply" }).click();
  const row = luca.page.getByTestId("agent-thread").filter({ hasText: /ladder/ });
  await expect(row.getByTestId("thread-badge")).toBeVisible({ timeout: 15_000 });

  // Opening it shows only that request, and clears its badge.
  await row.click();
  await expect(luca.page.getByText("💬 @marco answered personally: “Yes, it's in the shed”")).toBeVisible();
  await expect(luca.page.getByText("Plan lunch with @paul on Sunday")).toHaveCount(0);
  await luca.page.getByTestId("back-to-my-agent").click();
  await expect(luca.page.getByRole("heading", { name: "My Agent" })).toBeVisible(); // the list, not the thread
  await expect(luca.page.getByTestId("agent-thread").filter({ hasText: /ladder/ }).getByTestId("thread-badge")).toHaveCount(0);
  await luca.close();
  await marco.close();
});

test("what your agent knows: topics with quick picks, your own topic, a preview, and “Shall I remember…?” from My Agent", async ({ browser }) => {
  const id = Date.now().toString(36).slice(-6);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`about${id}@agentme.test`);
  await page.getByLabel("Password").fill("a-good-password");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Your name").fill("Ada");
  await page.getByLabel("Agent address").fill(`ada${id}`);
  await page.getByRole("button", { name: "Create my agent" }).click();
  await expect(page.getByText(`I'm @ada${id}, your agent`)).toBeVisible();

  await page.goto("/settings");
  await page.getByTestId("about-you-link").click();
  await expect(page.getByRole("heading", { name: "What your agent knows about you" })).toBeVisible();

  // Hobbies from quick picks, shared by default.
  const hobbies = page.getByTestId("topic-interests");
  await hobbies.locator("summary").click();
  await hobbies.getByRole("button", { name: "＋ Climbing" }).click();
  await hobbies.getByRole("button", { name: "＋ Cinema" }).click();
  await expect(hobbies.getByLabel("Hobbies & interests")).toHaveValue("Climbing, Cinema");
  await expect(hobbies.getByRole("radio", { name: /My contacts' agents/ })).toBeChecked();
  await hobbies.getByRole("button", { name: "Save" }).click();
  await expect(hobbies.getByRole("status")).toContainText("Saved");

  // Budget starts private.
  const budget = page.getByTestId("topic-budget");
  await budget.locator("summary").click();
  await budget.getByRole("button", { name: "＋ ££ mid-range" }).click();
  await expect(budget.getByRole("radio", { name: /Only my agent/ })).toBeChecked();
  await budget.getByRole("button", { name: "Save" }).click();
  await expect(budget.getByRole("status")).toContainText("Saved");

  // A topic of your own.
  const own = page.getByTestId("add-own-topic");
  await own.locator("summary").click();
  await own.getByLabel("Topic name").fill("Music I like");
  await own.getByLabel("Topic details").fill("Jazz");
  await own.getByRole("button", { name: "Add topic" }).click();
  await expect(page.getByTestId("topic-custom")).toContainText("Music I like");

  // What friends' agents could get.
  const preview = page.getByTestId("profile-preview");
  await preview.locator("summary").click();
  await expect(preview).toContainText("Climbing, Cinema; Music I like: Jazz");
  await expect(preview).toContainText("Never shared: 💸 Budget for going out");

  // Telling the agent: it offers to remember, and saves only on Save.
  await page.goto("/chats");
  await page.getByRole("link", { name: /My Agent/ }).click();
  await send(page, "I'm vegetarian now");
  const offer = page.getByTestId("fact-suggestion");
  await expect(offer).toBeVisible();
  await offer.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("fact-saved")).toBeVisible();
  await page.goto("/settings/about");
  await expect(page.getByTestId("topic-food")).toContainText("vegetarian");
  await context.close();
});
