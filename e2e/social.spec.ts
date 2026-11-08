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

  // An admin removes Paul: he's told under Groups, with a badge until he's seen it.
  await luca.page.getByTestId("group-member").filter({ hasText: "Paul" }).getByRole("button", { name: "Remove" }).click();
  await expect(luca.page.getByTestId("group-member")).toHaveCount(2);
  const paul = await as(browser, "paul");
  await expect(paul.page.getByTestId("groups-badge")).toBeVisible();
  await paul.page.getByRole("navigation").first().getByRole("link", { name: /^Groups/ }).click();
  await expect(paul.page.getByTestId("notice").first()).toContainText(`Luca removed you from “${name}”`);
  await expect(paul.page.getByTestId("groups-badge")).toHaveCount(0);
  await luca.close();
  await marco.close();
  await paul.close();
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
  // The header search on the Communities tab finds public communities to join.
  await eve.page.getByRole("combobox", { name: "Search communities" }).fill(name);
  await expect(eve.page.getByRole("option", { name: new RegExp(name) })).toContainText("Public · 1 member");
  await eve.page.getByRole("option", { name: new RegExp(name) }).click();
  await expect(eve.page).toHaveURL(/\/communities\/[0-9a-f-]+$/);
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

test("businesses in groups: an admin adds one, it answers only when mentioned, anyone can remove it", async ({ browser }) => {
  const name = `Pizza night ${suffix()}`;
  const luca = await as(browser, "luca");
  await luca.page.getByRole("navigation").getByRole("link", { name: "Groups" }).click();
  await luca.page.getByRole("button", { name: "＋ New group" }).click();
  const form = luca.page.getByRole("form", { name: "New group" });
  await form.getByLabel("Group name").fill(name);
  await form.getByRole("combobox", { name: "Search contacts" }).fill("mar");
  await form.getByRole("option", { name: /Marco/ }).click();
  await form.getByRole("button", { name: "Create group" }).click();
  await expect(luca.page.getByRole("heading", { name })).toBeVisible();

  // Added as a business, not as a member.
  const businesses = luca.page.getByRole("region", { name: "Businesses" });
  await businesses.getByText("＋ Add a business").click();
  await businesses.getByLabel("Business @address").fill("trattoria");
  await businesses.getByRole("button", { name: "Add", exact: true }).click();
  await expect(businesses.getByTestId("group-business")).toContainText("@trattoria");
  await expect(luca.page.getByTestId("group-member")).toHaveCount(2);
  const chatUrl = luca.page.url().replace("/groups/", "/chats/");

  // A message without a mention: the business stays quiet. With one: it answers for everyone.
  const marco = await as(browser, "marco");
  await marco.page.goto(chatUrl);
  await expect(marco.page.getByLabel("Message", { exact: true })).toHaveAttribute("placeholder", /@trattoria to ask the business/);
  await send(marco.page, "Shall we try that Italian place?");
  await send(marco.page, "@trattoria do you have vegetarian options?");
  await expect(marco.page.getByText(/about half the menu is vegetarian/)).toBeVisible();
  await expect(marco.page.getByText("@trattoria's agent")).toHaveCount(1);
  await luca.page.goto(chatUrl);
  await expect(luca.page.getByText(/about half the menu is vegetarian/)).toBeVisible();

  // The business sees where it was added (not the group's messages).
  const shop = await as(browser, "trattoria");
  await shop.page.goto("/business");
  await expect(shop.page.getByTestId("placement").filter({ hasText: name })).toBeVisible();
  await shop.page.goto(chatUrl);
  await expect(shop.page.getByText("Shall we try that Italian place?")).toHaveCount(0);

  // Any member can remove it.
  await marco.page.goto(chatUrl.replace("/chats/", "/groups/"));
  await marco.page.getByTestId("group-business").getByRole("button", { name: "Remove" }).click();
  await expect(marco.page.getByTestId("group-business")).toHaveCount(0);
  await marco.page.goto(chatUrl);
  await expect(marco.page.getByTestId("system-note").filter({ hasText: "removed" })).toContainText("from the group");

  await Promise.all([luca.close(), marco.close(), shop.close()]);
});
