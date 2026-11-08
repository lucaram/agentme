import { expect, test, type Browser, type Page } from "@playwright/test";

// Runs after the other specs on the same seeded database (one worker).

const PASSWORD = "password123";

async function as(browser: Browser, handle: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept()); // "Are you sure?" confirmations
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

const suffix = () => Date.now().toString().slice(-6);

test("groups: create from the Groups tab, only admins send, make someone admin", async ({ browser }) => {
  const name = `Five-a-side ${suffix()}`;
  const luca = await as(browser, "luca");
  await luca.page.getByRole("navigation").getByRole("link", { name: "Groups" }).click();
  await luca.page.getByRole("button", { name: "＋ New group" }).click();
  const form = luca.page.getByRole("form", { name: "New group" });
  await form.getByLabel("Group name").fill(name);
  const search = form.getByRole("combobox", { name: "Search contacts" });
  await search.fill("mar");
  await form.getByRole("option", { name: /Marco/ }).click();
  await search.fill("@pau");
  await search.press("Enter");
  await expect(form.getByTestId("picked-member")).toHaveText([/Marco/, /Paul/]);
  await form.getByRole("button", { name: "Create group" }).click();
  await expect(luca.page).toHaveURL(/\/groups\/[0-9a-f-]+$/);
  await expect(luca.page.getByRole("heading", { name })).toBeVisible();
  await expect(luca.page.getByTestId("group-member")).toHaveCount(3);
  await expect(luca.page.getByTestId("group-member").filter({ hasText: "You" })).toContainText("Owner");

  await luca.page.getByLabel("Only admins can send messages").check();
  const chatUrl = luca.page.url().replace("/groups/", "/chats/");

  const marco = await as(browser, "marco");
  await expect
    .poll(async () => {
      await marco.page.goto(chatUrl);
      return marco.page.getByTestId("cannot-post").count();
    })
    .toBe(1);
  await expect(marco.page.getByTestId("cannot-post")).toContainText("Only admins can send messages");

  await luca.page.getByTestId("group-member").filter({ hasText: "Marco" }).getByRole("button", { name: "Make admin" }).click();
  await expect(luca.page.getByTestId("group-member").filter({ hasText: "Marco" })).toContainText("Admin");
  await marco.page.reload();
  await expect(marco.page.getByTestId("cannot-post")).toHaveCount(0);
  await send(marco.page, "Pitch booked for Thursday!");
  await expect(marco.page.getByText("Pitch booked for Thursday!")).toBeVisible();
  await luca.close();
  await marco.close();
});

test("communities: create, join by accepting the rules, Announcements vs General, moderators remove messages", async ({ browser }) => {
  const name = `Test FC Fans ${suffix()}`;
  const luca = await as(browser, "luca");
  await luca.page.getByRole("navigation").getByRole("link", { name: "Communities" }).click();
  await luca.page.getByRole("button", { name: "＋ New community" }).click();
  const form = luca.page.getByRole("form", { name: "New community" });
  await form.getByLabel("Name").fill(name);
  await form.getByLabel("What is it about?").fill("Match days, transfers and banter");
  await form.getByLabel(/Rules/).fill("Be kind. No spam.");
  await form.getByRole("button", { name: "Create community" }).click();
  await expect(luca.page).toHaveURL(/\/communities\/[0-9a-f-]+$/);
  const communityUrl = luca.page.url();

  // Eve finds it in Discover communities and joins after accepting the rules.
  const eve = await as(browser, "eve");
  await eve.page.goto("/communities");
  await eve.page.getByLabel("Search communities").fill(name);
  await eve.page.getByRole("button", { name: "Search" }).click();
  await eve.page.getByTestId("community-row").filter({ hasText: name }).click();
  await expect(eve.page.getByRole("button", { name: "Join community" })).toBeDisabled();
  await eve.page.getByLabel("I accept the rules").check();
  await eve.page.getByRole("button", { name: "Join community" }).click();
  await eve.page.getByRole("link", { name: /General/ }).click();
  await send(eve.page, "Hello fans!");
  await expect(eve.page.getByText("Hello fans!")).toBeVisible();

  // Announcements are for moderators.
  await eve.page.goto(communityUrl);
  await eve.page.getByRole("link", { name: /Announcements/ }).click();
  await expect(eve.page.getByTestId("cannot-post")).toContainText("Only moderators post announcements");

  // The owner removes a message for everyone.
  await luca.page.goto(communityUrl);
  await luca.page.getByRole("link", { name: /General/ }).click();
  const message = luca.page.getByRole("listitem").filter({ hasText: "Hello fans!" });
  await message.getByLabel("Message options").click();
  await message.getByRole("button", { name: /Remove for everyone/ }).click();
  await expect(luca.page.getByTestId("removed-message").filter({ hasText: "removed by a moderator" })).toBeVisible();
  await luca.close();
  await eve.close();
});
