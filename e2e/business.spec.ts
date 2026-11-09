import { expect, test, type Browser, type Page } from "@playwright/test";

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

/** My Business sections open one at a time: open the one a step needs (if it isn't already). */
async function openSection(page: Page, testId: string) {
  const fold = page.getByTestId(testId);
  if ((await fold.getAttribute("open")) === null) await fold.locator("summary").first().click();
}

async function send(page: Page, text: string) {
  await page.getByLabel("Message", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

test("my business: the agent reads the menu link, answers from it, and asks the team when it doesn't know", async ({ browser, baseURL }) => {
  // The business describes itself in plain language and adds its menu page.
  const shop = await as(browser, "trattoria");
  await shop.page.getByRole("navigation").first().getByRole("link", { name: "My Business" }).click();
  // A web address written in the text is added to the links the agent reads.
  await openSection(shop.page, "fold-own-words");
  await shop.page
    .getByRole("textbox", { name: /About your business/ })
    .fill(`Family-run Italian restaurant in Camden. Open Tue–Sun 12–15 and 18–23.
Our menu: ${baseURL}/demo/trattoria-menu.html`);
  await shop.page.getByRole("button", { name: "Save your words" }).click();
  await expect(shop.page.getByRole("status").filter({ hasText: "I also added 1 link from your text" })).toBeVisible();
  await openSection(shop.page, "fold-links");
  await expect(shop.page.getByTestId("source-status").first()).toContainText("✓ Read", { timeout: 20_000 });
  // Shown as the same link seen from two places, not a duplicate.
  await expect(shop.page.getByTestId("source-from-text")).toContainText("📝 from your link in About your business");

  // Try it: answered from the menu it read.
  await openSection(shop.page, "fold-knows");
  await shop.page.getByLabel("Test question").fill("Do you have panna cotta?");
  await shop.page.getByRole("button", { name: "See the answer" }).click();
  await expect(shop.page.getByTestId("try-answer")).toContainText("Panna cotta");

  // Questions & answers can be added by hand; the agent uses them straight away.
  await openSection(shop.page, "fold-faqs");
  await shop.page.getByRole("button", { name: "＋ Add a question" }).click();
  await shop.page.getByLabel("Question", { exact: true }).fill("Is there a kids menu?");
  await shop.page.getByLabel("Answer", { exact: true }).fill("Yes: small pasta and pizzas for £6.");
  await shop.page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(shop.page.getByTestId("faq-list")).toContainText("Is there a kids menu?");
  await openSection(shop.page, "fold-knows");
  await shop.page.getByLabel("Test question").fill("Do you have a kids menu?");
  await shop.page.getByRole("button", { name: "See the answer" }).click();
  await expect(shop.page.getByTestId("try-answer")).toContainText("small pasta and pizzas");

  // A visitor asks something that isn't there: the agent says it asked the team.
  const luca = await as(browser, "luca");
  await luca.page.goto("/discover?q=tratt");
  await luca.page.getByRole("button", { name: "Ask agent" }).click();
  await send(luca.page, "Is there parking nearby?");
  await expect(luca.page.getByText("I've asked the team")).toBeVisible();

  // The business answers under Needs your answer; it goes back to Luca and into the business info.
  await shop.page.goto("/chats");
  await shop.page.getByTestId("my-agent-card").click();
  const item = shop.page.getByTestId("inbox-item").filter({ hasText: "asked your business" });
  await item.getByLabel(/Your answer/).fill("Yes, a public car park two minutes away on Pratt Street.");
  await item.getByRole("button", { name: "Send answer" }).click();
  await expect(luca.page.getByText("The team at Trattoria Sole: Yes, a public car park two minutes away")).toBeVisible({ timeout: 15_000 });
  await shop.page.goto("/business");
  await openSection(shop.page, "fold-faqs");
  await expect(shop.page.getByRole("region", { name: "Questions and answers" })).toContainText("Is there parking nearby?");
  await shop.close();
  await luca.close();
});

test("a business's permanent QR code: printable poster, and scanning it lets anyone ask the agent", async ({ browser, baseURL }) => {
  const shop = await as(browser, "trattoria");
  await shop.page.goto("/contacts");
  await shop.page.getByTestId("fold-add-people").locator("summary").first().click();
  await shop.page.getByText("📷 Show my QR code").click();
  // Permanent: the plain business page, no expiring token.
  await expect(shop.page.getByTestId("qr-code")).toHaveAttribute("data-url", `${baseURL}/u/trattoria`);
  await shop.page.getByTestId("print-poster").click();
  await expect(shop.page.getByTestId("qr-poster")).toContainText("Scan to ask us anything");

  // A customer scans it: one tap opens a chat with the business's agent.
  const luca = await as(browser, "luca");
  await luca.page.goto("/u/trattoria");
  await luca.page.getByRole("button", { name: "💬 Ask us anything" }).click();
  await expect(luca.page).toHaveURL(/\/chats\/[0-9a-f-]+$/);
  await expect(luca.page.getByRole("heading", { name: /Trattoria Sole/ })).toBeVisible();
  await shop.close();
  await luca.close();
});

test("add a business from a personal account and switch between the two", async ({ browser }) => {
  const id = Date.now().toString(36).slice(-6);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`owner${id}@agentme.test`);
  await page.getByLabel("Password").fill("a-good-password");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Your name").fill("Gina");
  await page.getByLabel("Agent address").fill(`gina${id}`);
  await page.getByRole("button", { name: "Create my agent" }).click();
  await expect(page.getByText(`I'm @gina${id}, your agent`)).toBeVisible();

  // From the switcher at the top: add a business.
  const switcher = page.getByTestId("identity-switcher");
  await expect(switcher).toContainText("Personal");
  await switcher.click();
  await page.getByTestId("add-business-link").click();
  const form = page.getByRole("form", { name: "Add a business" });
  await form.getByLabel("Business name").fill(`Gina Bakery ${id}`);
  // The address is suggested from the name.
  await expect(form.getByLabel("Agent address")).toHaveValue(`gina_bakery_${id}`);
  await expect(form.getByText(`@gina_bakery_${id} is available.`)).toBeVisible();
  await form.getByRole("button", { name: "Picture ☕" }).click();
  await form.getByLabel(/In a few words/).fill("Sourdough and pastries in Hackney. Open daily 7–15.");
  await form.getByRole("button", { name: "Create business" }).click();

  // Now acting as the business, on My Business.
  await expect(page.getByTestId("business-welcome")).toContainText(`live at @gina_bakery_${id}`);
  await expect(switcher).toContainText("Business");
  await expect(page.getByRole("navigation").first().getByRole("link", { name: "My Business" })).toBeVisible();
  await openSection(page, "fold-own-words");
  await expect(page.getByRole("textbox", { name: /About your business/ })).toHaveValue(/Sourdough and pastries/);

  // A visitor asks something the business didn't say: it waits for the business, not for Gina's personal account.
  const luca = await as(browser, "luca");
  await luca.page.goto(`/u/gina_bakery_${id}`);
  await luca.page.getByRole("button", { name: /Ask us anything/ }).click();
  await send(luca.page, "Do you make birthday cakes?");
  await expect(luca.page.getByText("I've asked the team")).toBeVisible();

  // Back to the personal account: separate chats, and a badge for what's waiting in the business.
  await switcher.click();
  await page.getByTestId(`identity-gina${id}`).click();
  await expect(switcher).toContainText("Personal");
  await expect(page.getByRole("navigation").first().getByRole("link", { name: "My Business" })).toHaveCount(0);
  await expect(page.getByTestId("identity-waiting")).toBeVisible();
  await page.goto("/chats");
  await expect(page.getByText("Do you make birthday cakes?")).toHaveCount(0);

  // And into the business again: the question is waiting there.
  await switcher.click();
  await page.getByTestId(`identity-gina_bakery_${id}`).click();
  await expect(switcher).toContainText("Business");
  await page.getByTestId("my-agent-card").click();
  await expect(page.getByTestId("inbox-item").filter({ hasText: "birthday cakes" })).toBeVisible();

  await luca.close();
  await context.close();
});

test("how to book: the business adds its own ways; its page, its agent and friends' plans send people there", async ({ browser }) => {
  // The business says how customers book (AGENTME never books itself).
  const shop = await as(browser, "trattoria");
  await shop.page.goto("/business");
  await openSection(shop.page, "fold-book");
  const ways = shop.page.getByRole("form", { name: "How customers book or order" });
  await ways.getByLabel("Way 1: what is it").selectOption("book");
  await ways.getByLabel("Way 1: link or number").fill("trattoria-sole.example/book");
  await expect(ways.getByTestId("way-preview").first()).toContainText("📅 Book online");
  await ways.getByRole("button", { name: "＋ Add another way" }).click();
  await ways.getByLabel("Way 2: what is it").selectOption("call");
  await ways.getByLabel("Way 2: link or number").fill("020 7946 0000");
  await ways.getByRole("button", { name: "Save booking & ordering" }).click();
  await expect(ways.getByRole("status")).toContainText("Saved");

  // Its page shows them as buttons.
  const luca = await as(browser, "luca");
  await luca.page.goto("/u/trattoria");
  const buttons = luca.page.getByTestId("business-ways");
  await expect(buttons.getByRole("link", { name: "📅 Book online" })).toHaveAttribute("href", "https://trattoria-sole.example/book");
  await expect(buttons.getByRole("link", { name: "📞 Call 020 7946 0000" })).toHaveAttribute("href", "tel:02079460000");

  // Its agent gives the way to book instead of promising anything.
  await luca.page.getByRole("button", { name: /Ask us anything/ }).click();
  await send(luca.page, "Can I book a table for 4 on Friday?");
  await expect(luca.page.getByText(/https:\/\/trattoria-sole\.example\/book/).last()).toBeVisible();

  // A plan at @trattoria: the place is the business (not a participant) and the plan links to its booking page.
  await luca.page.goto("/chats");
  await luca.page.getByTestId("my-agent-card").click();
  await send(luca.page, "Organise pizza at @trattoria on Friday at 8pm with @marco");
  const task = luca.page.getByRole("region", { name: "Agent task" }).last();
  await task.getByRole("button", { name: "Approve" }).click();
  await expect(luca.page.getByText(/I've invited everyone in a new group/).last()).toBeVisible();
  const marco = await as(browser, "marco");
  await marco.page.getByRole("link", { name: /^👥 Get-together/ }).first().click();
  const venue = marco.page.getByTestId("proposal").last().getByTestId("plan-venue");
  await expect(venue).toContainText("At Trattoria");
  await expect(venue.getByRole("link", { name: "📅 Book online" })).toHaveAttribute("href", "https://trattoria-sole.example/book");

  await Promise.all([shop.close(), luca.close(), marco.close()]);
});

test("my agent asks a business for me: with @ straight away, named without @ only if I tap", async ({ browser }) => {
  const luca = await as(browser, "luca");
  await luca.page.goto("/chats");
  await luca.page.getByRole("link", { name: /My Agent/ }).click();
  await expect(luca.page.getByRole("heading", { name: "My Agent" })).toBeVisible();

  // With the @: my agent asks the business's agent and brings the answer back.
  await send(luca.page, "@trattoria do you have vegetarian options?");
  await expect(luca.page.getByText("I asked @trattoria").last()).toBeVisible();
  await expect(luca.page.getByText(/about half the menu is vegetarian/).last()).toBeVisible();
  await expect(luca.page.getByTestId("continue-with-business").last()).toContainText("Continue with @trattoria");

  // Passing it on is mine to do: my agent doesn't forward what others wrote, and no card is made.
  await send(luca.page, "please share this with @marco");
  await expect(luca.page.getByText("I don't pass things on myself").last()).toBeVisible();
  await expect(luca.page.getByRole("region", { name: "Agent task" })).toHaveCount(0);

  // My own words to one contact go to our direct chat once I approve (not a new group).
  await send(luca.page, "Tell @marco: the trattoria has lots of vegetarian dishes");
  const task = luca.page.getByRole("region", { name: "Agent task" }).last();
  await expect(task).toContainText("Send to @marco in your direct chat");
  await task.getByRole("button", { name: "Approve" }).click();
  const marco = await as(browser, "marco");
  await marco.page.getByRole("link", { name: /lots of vegetarian dishes/ }).first().click();
  await expect(marco.page.getByRole("heading", { name: /Luca/ })).toBeVisible();
  const told = marco.page.getByRole("listitem").filter({ hasText: "the trattoria has lots of vegetarian dishes" });
  await expect(told).toBeVisible();
  await expect(told.getByTitle("Written by an AI agent")).toHaveCount(0);
  await marco.close();

  // Named without the @, in a question: my agent offers first, and asks only when I tap.
  await send(luca.page, "Is Trattoria Sole open on Mondays?");
  const offer = luca.page.getByTestId("business-suggestion").last();
  await expect(luca.page.getByText("Trattoria Sole (@trattoria) is on AGENTME").last()).toBeVisible();
  await offer.getByRole("button", { name: "Ask @trattoria" }).click();
  await expect(luca.page.getByText("✓ Asked @trattoria").last()).toBeVisible();
  await expect(luca.page.getByText("I asked @trattoria")).toHaveCount(2);
  await luca.close();
});

test("↪ Forward: I pass on a business's answer myself, labelled as forwarded from its agent", async ({ browser }) => {
  const luca = await as(browser, "luca");
  await luca.page.goto("/chats");
  await luca.page.getByRole("link", { name: /My Agent/ }).click();
  await send(luca.page, "@trattoria do you take group bookings?");
  await expect(luca.page.getByText(/groups of up to 12/).last()).toBeVisible();

  // I choose where it goes (up to 5 chats); people will see where it came from.
  await luca.page.getByTestId("forward-button").last().click();
  const picker = luca.page.getByTestId("forward-picker");
  await expect(picker).toContainText("↪ Forwarded · from @trattoria's agent");
  await picker.getByRole("checkbox", { name: "Marco", exact: true }).check();
  await picker.getByRole("checkbox", { name: "Paul", exact: true }).check();
  await picker.getByRole("button", { name: "↪ Forward to 2 chats" }).click();
  await expect(picker.getByTestId("forward-results")).toContainText("✓ Sent to Marco");
  await expect(picker.getByTestId("forward-results")).toContainText("✓ Sent to Paul");
  await picker.getByRole("button", { name: "Done" }).click();

  // My own agent's replies can be forwarded too (from ⋯), labelled as written by my agent.
  await send(luca.page, "What can you do for me?");
  const reply = luca.page.getByRole("listitem").filter({ hasText: "I can coordinate plans" }).last();
  await reply.getByLabel("Message options").click();
  await reply.getByRole("button", { name: "↪ Forward" }).click();
  await expect(luca.page.getByTestId("forward-picker")).toContainText("↪ Forwarded · from @luca's agent");
  await luca.page.getByTestId("forward-picker").getByRole("button", { name: "Close" }).click();

  // Marco gets it in our direct chat: from Luca, labelled, without my agent's "I asked" line.
  const marco = await as(browser, "marco");
  await marco.page.getByRole("link", { name: /groups of up to 12/ }).first().click();
  const forwarded = marco.page.getByRole("listitem").filter({ hasText: "groups of up to 12" }).last();
  await expect(forwarded.getByTestId("forwarded-label")).toHaveText("↪ Forwarded · from @trattoria's agent");
  await expect(forwarded).not.toContainText("I asked");
  await expect(forwarded.getByTitle("Written by an AI agent")).toHaveCount(0);
  await Promise.all([luca.close(), marco.close()]);
});
