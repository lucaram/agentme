import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { config } from "dotenv";
import { businessStaffFixture } from "../tests/fixtures/business-staff";
config({ path: ".env.local", quiet: true });

test("staff accept privately, switch safely, handle shared requests and lose only business access when removed", async ({ browser }) => {
  test.setTimeout(240_000);
  const f = await businessStaffFixture(); const sessions: BrowserContext[] = [];
  const login = async (email: string) => {
    const context = await browser.newContext(); sessions.push(context); const page = await context.newPage();
    await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(f.password); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(/\/chats/); return page;
  };
  const open = async (page: Page, id: string) => { const section = page.getByTestId(id); if (await section.getAttribute("open") === null) await section.locator("summary").first().click(); return section; };
  const myAgent = async (page: Page) => { await page.goto("/chats"); const card = page.getByTestId("my-agent-card"); if (await card.count()) await page.goto((await card.getAttribute("href"))!); else await page.getByRole("button", { name: "Talk to your agent", exact: true }).click(); await expect(page.getByRole("heading", { name: "My Agent", exact: true })).toBeVisible(); };
  try {
    const owner = await login(f.business.email); await owner.goto("/business"); const staffCard = await open(owner, "fold-staff");
    await staffCard.getByRole("combobox", { name: "Search people to invite", exact: true }).fill(`@${f.marco.agent.handle}`); await staffCard.getByRole("option", { name: new RegExp(f.marco.agent.handle) }).click(); await expect(staffCard.getByTestId("selected-staff")).toContainText("Marco"); await staffCard.getByRole("button", { name: "Create invitation", exact: true }).click();
    const link = staffCard.getByLabel("Staff invitation link"); await expect(link).toHaveValue(/\/staff-invite\//); const invitationUrl = await link.inputValue();
    const loggedOut = await browser.newContext(); sessions.push(loggedOut); const invitationPage = await loggedOut.newPage(); await invitationPage.goto(invitationUrl); await expect(invitationPage).toHaveURL(/\/login\?next=/); expect(new URL(invitationPage.url()).searchParams.get("next")).toBe(new URL(invitationUrl).pathname); await expect(invitationPage.getByRole("button", { name: "Log in", exact: true })).toBeVisible(); await expect(invitationPage.getByRole("link", { name: "Create personal account", exact: true })).toHaveCount(0); await loggedOut.close();
    const marco = await login(f.marco.email); await marco.goto(invitationUrl); await marco.getByRole("button", { name: "Accept invitation", exact: true }).click(); await expect(marco.getByRole("status")).toContainText(/Your choice is saved|Your invitation is accepted/);
    await marco.goto("/chats"); await marco.getByTestId("identity-switcher").click(); await marco.getByTestId(`identity-${f.business.agent.handle}`).click();
    await expect(marco.getByTestId("identity-switcher")).toContainText(f.business.agent.handle); await expect(marco.getByTestId("own-presence")).toHaveText("Off duty");
    await marco.getByTestId("identity-switcher").click(); await marco.getByRole("checkbox", { name: "Available for customer requests", exact: true }).check(); await expect(marco.getByTestId("own-presence")).toHaveText("Work: Online"); await marco.getByTestId("identity-switcher").click();
    await marco.goto("/business"); await expect(marco.getByRole("button", { name: "Test your agent", exact: true })).toHaveCount(0); await open(marco, "fold-staff"); await expect(marco.getByRole("button", { name: "Create invitation", exact: true })).toHaveCount(0);
    await marco.goto("/settings/profile"); await expect(marco.getByText(/An owner or manager manages this business profile/)).toBeVisible(); await expect(marco.getByRole("button", { name: "Delete everything", exact: true })).toHaveCount(0);
    const luca = await login(f.luca.email); await luca.goto(`/chats/${f.direct}`); await luca.getByRole("textbox", { name: "Message", exact: true }).fill("Can you securely store four bicycles indoors?"); await luca.getByRole("button", { name: "Send", exact: true }).click(); await luca.getByRole("button", { name: "Ask the team", exact: true }).click();
    await myAgent(marco); const request = marco.getByTestId("inbox-item").filter({ hasText: "four bicycles" }); await expect(request).toBeVisible(); await request.getByRole("button", { name: "I'll handle this", exact: true }).click(); await expect(request).toContainText("Marco is handling this");
    await myAgent(owner); const ownerRequest = owner.getByTestId("inbox-item").filter({ hasText: "four bicycles" }); await expect(ownerRequest).toContainText("Marco is handling this"); await expect(ownerRequest.getByRole("button", { name: "Send answer", exact: true })).toBeDisabled();
    await request.getByLabel(/Your answer/).fill("Yes, we can store four bicycles indoors during your meal."); await request.getByRole("checkbox", { name: "Suggest this as a reusable answer for approval", exact: true }).check(); await request.getByRole("button", { name: "Send answer", exact: true }).click(); await expect(request).toHaveCount(0);
    await expect(luca.getByRole("list", { name: "Messages", exact: true })).toContainText("The team at Trattoria Sole: Yes, we can store four bicycles");
    const review = owner.getByTestId("business-answer-review"); await expect(review).toBeVisible(); await review.getByRole("button", { name: "Approve & publish", exact: true }).click(); await expect(review).toHaveCount(0);
    await owner.goto("/business"); await open(owner, "fold-faqs"); await expect(owner.getByTestId("fold-faqs")).toContainText("Yes, we can store four bicycles"); await open(owner, "fold-staff");
    const member = owner.getByRole("list", { name: "Business team", exact: true }).getByRole("listitem").filter({ hasText: "Marco" }); await member.getByRole("button", { name: "Remove access", exact: true }).click(); await owner.getByRole("dialog", { name: "Remove business access", exact: true }).getByRole("button", { name: "Confirm change", exact: true }).click();
    await expect(marco).toHaveURL(/\/login/, { timeout: 30_000 }); await expect(marco.getByRole("status")).toContainText("Your business access has ended");
    await marco.getByLabel("Email", { exact: true }).fill(f.marco.email); await marco.getByLabel("Password", { exact: true }).fill(f.password); await marco.getByRole("button", { name: "Log in", exact: true }).click(); await expect(marco).toHaveURL(/\/chats/); await expect(marco.getByTestId("identity-switcher")).toContainText(f.marco.agent.handle);
    await marco.getByTestId("identity-switcher").click(); await expect(marco.getByTestId(`identity-${f.business.agent.handle}`)).toHaveCount(0);
  } finally { await Promise.allSettled(sessions.map((context) => context.close())); await f.cleanup(); }
});

test("registered-user invitations and assignment choices follow the acting person's role", async ({ browser }) => {
  test.setTimeout(180_000);
  const f = await businessStaffFixture(); const sessions: BrowserContext[] = []; let eveId: string | undefined;
  const login = async (email: string) => { const context = await browser.newContext(); sessions.push(context); const page = await context.newPage(); await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(f.password); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(/\/chats/); return page; };
  const myAgent = async (page: Page) => { await page.goto("/chats"); const card = page.getByTestId("my-agent-card"); if (await card.count()) await page.goto((await card.getAttribute("href"))!); else await page.getByRole("button", { name: "Talk to your agent", exact: true }).click(); await expect(page.getByRole("heading", { name: "My Agent", exact: true })).toBeVisible(); };
  const staffSection = async (page: Page) => { await page.goto("/business"); const section = page.getByTestId("fold-staff"); await section.locator("summary").first().click(); return section; };
  const invite = async (page: Page, handle: string, role: string) => {
    const section = page.getByTestId("fold-staff"); const create = section.getByRole("button", { name: "Create invitation", exact: true }); await expect(create).toBeDisabled();
    const input = section.getByRole("combobox", { name: "Search people to invite", exact: true }); await input.fill(`@${handle}`); await expect(create).toBeDisabled();
    await expect(section.getByRole("option", { name: new RegExp(handle) })).toBeVisible(); await input.press("ArrowDown"); await input.press("Enter"); await expect(section.getByTestId("selected-staff")).toContainText(`@${handle}`);
    await section.getByLabel("Invitation role", { exact: true }).selectOption(role); await create.click(); await expect(section.getByLabel("Staff invitation link", { exact: true })).toHaveValue(/\/staff-invite\//); await expect(section.getByTestId("selected-staff")).toHaveCount(0);
  };
  const accept = async (page: Page) => { await myAgent(page); await page.getByTestId("staff-invitation").getByRole("button", { name: "Accept invitation", exact: true }).click(); await expect(page.getByTestId("staff-invitation")).toHaveCount(0); await page.getByTestId("identity-switcher").click(); await page.getByTestId(`identity-${f.business.agent.handle}`).click(); await expect(page.getByTestId("identity-switcher")).toContainText(f.business.agent.handle); };
  try {
    const tag = crypto.randomUUID().slice(0, 8); const email = `staff_eve_${tag}@agentme.test`; const handle = `staff_eve_${tag}`;
    const made = await f.db.auth.admin.createUser({ email, password: f.password, email_confirm: true }); if (made.error) throw made.error; eveId = made.data.user.id;
    expect((await f.db.from("agents").insert({ owner_id: eveId, display_name: "Eve", handle, type: "personal" })).error).toBeNull();
    expect((await f.db.from("inbox_items").insert({ owner_id: f.business.userId, agent_id: f.business.agent.id, kind: "question", payload: { kind: "question", business: true, question: "Can you store a cello securely?", faq_eligible: true } })).error).toBeNull();
    const owner = await login(f.business.email); await myAgent(owner); const ownerQuestion = owner.getByTestId("inbox-item").filter({ hasText: "store a cello" });
    await expect(ownerQuestion.getByRole("button", { name: "I'll handle this", exact: true })).toBeVisible(); await expect(ownerQuestion.getByRole("combobox", { name: "Assign customer question", exact: true })).toHaveCount(0);
    const section = await staffSection(owner); await expect(section.getByRole("list", { name: "Business team", exact: true })).toContainText("Trattoria Sole — Owner (you)");
    await invite(owner, f.marco.agent.handle, "manager");
    const marco = await login(f.marco.email); await accept(marco); await staffSection(marco);
    await invite(marco, f.paul.agent.handle, "staff"); await invite(marco, handle, "staff");
    const paul = await login(f.paul.email); await accept(paul); const eve = await login(email); await accept(eve);
    await myAgent(marco); const question = marco.getByTestId("inbox-item").filter({ hasText: "store a cello" }); const assign = question.getByRole("combobox", { name: "Assign customer question", exact: true });
    await expect(assign.locator("option")).toHaveText(["Assign to…", "Paul — Staff", "Eve — Staff"]);
    await assign.selectOption(f.paul.userId); await expect(question).toContainText("Paul is handling this");
    await myAgent(paul); await expect(paul.getByTestId("inbox-item").getByRole("button", { name: "Send answer", exact: true })).toBeEnabled();
    await myAgent(eve); await expect(eve.getByTestId("inbox-item").getByRole("button", { name: "Send answer", exact: true })).toBeDisabled();
    await myAgent(owner); const ownerOptions = owner.getByTestId("inbox-item").getByRole("combobox", { name: "Assign customer question", exact: true }).locator("option");
    await expect(ownerOptions).toHaveText(["Assign to…", "Marco — Manager", "Paul — Staff", "Eve — Staff"]);
    await marco.setViewportSize({ width: 390, height: 844 }); await staffSection(marco); expect(await marco.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await Promise.allSettled(sessions.map((context) => context.close())); if (eveId) { await f.db.from("conversations").delete().eq("created_by", eveId); await f.db.auth.admin.deleteUser(eveId); } await f.cleanup(); }
});
