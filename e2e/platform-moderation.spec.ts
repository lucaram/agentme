import { expect, test, type BrowserContext, type Locator } from "@playwright/test";
import { config } from "dotenv";
import { planBusinessFixture } from "../tests/fixtures/plan-business";

config({ path: ".env.local", quiet: true });
async function login(context: BrowserContext, email: string, password: string) {
  const page = await context.newPage(); await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(password); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(/\/chats/); return page;
}

test("an account suspension stops an open chat, explains the decision, and permits an independently reviewed appeal", async ({ browser }) => {
  const f = await planBusinessFixture(); const contexts: BrowserContext[] = []; let independentUser = "";
  const session = async () => { const c = await browser.newContext(); contexts.push(c); return c; };
  try {
    const email = `independent-${crypto.randomUUID()}@agentme.test`;
    const made = await f.db.auth.admin.createUser({ email, password: f.password, email_confirm: true }); if (made.error) throw made.error; independentUser = made.data.user.id;
    expect((await f.db.from("agents").insert({ owner_id: independentUser, display_name: "Independent reviewer", type: "personal", handle: `appeal_${crypto.randomUUID().slice(0, 8)}` })).error).toBeNull();
    await f.db.from("platform_moderators").insert([{ user_id: f.paul.userId }, { user_id: independentUser }]);
    await f.db.from("contacts").insert({ requester_agent: f.luca.agent.id, addressee_agent: f.marco.agent.id, status: "accepted" });
    const conversation = await f.db.from("conversations").insert({ kind: "dm", created_by: f.luca.userId }).select("id").single(); expect(conversation.error).toBeNull(); const chat = conversation.data!.id;
    await f.db.from("conversation_members").insert([f.luca, f.marco].map((p) => ({ conversation_id: chat, user_id: p.userId })));
    const msg = await f.db.from("messages").insert({ conversation_id: chat, sender_user_id: f.marco.userId, content: "An example message under independent review", is_ai_generated: false }).select("id").single(); expect(msg.error).toBeNull();
    const marco = await login(await session(), f.marco.email, f.password); await marco.goto(`/chats/${chat}`); await expect(marco.getByRole("textbox", { name: "Message", exact: true })).toBeVisible();
    const luca = await login(await session(), f.luca.email, f.password); await luca.goto(`/chats/${chat}`);
    const row = luca.locator(`#m-${msg.data!.id}`); await row.getByLabel("Message options", { exact: true }).click(); await row.getByRole("button", { name: /Report/ }).click();
    const report = luca.getByRole("dialog", { name: "Report message", exact: true }); await report.getByLabel("What happened?", { exact: true }).fill("Please review this message with the selected evidence."); await report.getByRole("button", { name: "Review report", exact: true }).click(); await report.getByRole("button", { name: "Send report", exact: true }).click(); await expect(report.getByRole("status")).toBeVisible();
    const saved = await f.db.from("platform_reports").select("case_id").eq("reporter_id", f.luca.userId).single(); expect(saved.error).toBeNull(); const caseId = saved.data!.case_id;
    const paul = await login(await session(), f.paul.email, f.password); await paul.goto(`/moderation/${caseId}`);
    await paul.locator("summary").filter({ hasText: "Reporting history" }).click(); await expect(paul.getByText("No previous reports.", { exact: true })).toBeVisible();
    const form = paul.getByRole("form", { name: "Platform decision", exact: true }); const action = form.getByLabel("Action", { exact: true });
    await expect(action.locator('option[value="suspend_1m"]')).toHaveText("Temporary account suspension — 1 month"); await expect(action.locator('option[value="suspend_3m"]')).toHaveText("Temporary account suspension — 3 months"); await expect(action.locator('option[value="ban"]')).toHaveText("Permanent ban");
    await action.selectOption("suspend_1m"); await form.getByLabel("Justification", { exact: true }).fill("Repeated harassment established from the submitted evidence."); await form.getByLabel("Internal review notes (optional)", { exact: true }).fill("PRIVATE_REVIEW_NOTES");
    paul.once("dialog", (d) => d.dismiss()); await form.getByRole("button", { name: "Save decision", exact: true }).click(); await expect(form).toBeVisible(); expect((await f.db.from("platform_account_sanctions").select("id").eq("case_id", caseId)).data).toEqual([]);
    paul.once("dialog", (d) => d.accept()); await form.getByRole("button", { name: "Save decision", exact: true }).click(); await expect(paul.getByRole("region", { name: "Account restriction decision", exact: true })).toContainText("Repeated harassment");
    await expect(marco).toHaveURL(/\/account-status$/); await expect(marco.getByRole("heading", { name: "Account temporarily suspended", exact: true })).toBeVisible(); await expect(marco.getByRole("textbox", { name: "Message", exact: true })).toHaveCount(0);
    const own = marco.getByTestId("own-account-decision"); await expect(own).toContainText("Repeated harassment established"); await expect(own.locator("time")).toHaveCount(2); await expect(marco.getByText("PRIVATE_REVIEW_NOTES", { exact: false })).toHaveCount(0);
    await marco.goto("/chats"); await expect(marco).toHaveURL(/\/account-status$/);
    await marco.getByRole("button", { name: "Log out", exact: true }).click(); await expect(marco).toHaveURL(/\/login$/); await marco.getByLabel("Email", { exact: true }).fill(f.marco.email); await marco.getByLabel("Password", { exact: true }).fill(f.password); await marco.getByRole("button", { name: "Log in", exact: true }).click(); await expect(marco).toHaveURL(/\/account-status$/);
    await own.locator("summary").filter({ hasText: "Appeal this decision" }).click(); const appeal = marco.getByRole("form", { name: "Account appeal", exact: true }); await appeal.getByLabel("Why should this decision be reconsidered?", { exact: true }).fill("The selected message needs its surrounding context reviewed."); await appeal.getByRole("button", { name: "Submit appeal", exact: true }).click(); await expect(own).toContainText("Appeal submitted");
    await paul.goto("/moderation/appeals"); await expect(paul.getByText("No appeals in this queue.", { exact: true })).toBeVisible();
    const eve = await login(await session(), email, f.password); await eve.goto("/moderation/appeals"); const item = eve.getByTestId("account-appeal"); await expect(item).toContainText("surrounding context");
    const review = item.getByRole("form", { name: "Review account appeal", exact: true }); await review.getByLabel("Justification sent to the account", { exact: true }).fill("Further context shows the restriction should be lifted."); eve.once("dialog", (d) => d.accept()); await review.getByRole("button", { name: "Save appeal decision", exact: true }).click(); await expect(item).toHaveCount(0);
    await expect(marco.getByRole("heading", { name: "Account access available", exact: true })).toBeVisible(); await expect(own).toContainText("Appeal accepted"); await marco.getByRole("link", { name: "Return to AGENTME", exact: true }).click(); await expect(marco).toHaveURL(/\/chats$/); await marco.goto(`/chats/${chat}`); await expect(marco.getByRole("textbox", { name: "Message", exact: true })).toBeVisible();
    await paul.goto(`/moderation/${caseId}`); await expect(paul.getByRole("region", { name: "Account restriction decision", exact: true })).toContainText("Lifted");
  } finally {
    await Promise.allSettled(contexts.map((c) => c.close()));
    await f.db.from("platform_account_sanctions").delete().eq("user_key", f.marco.userId); await f.db.from("platform_cases").delete().eq("source_conversation", (await f.db.from("conversations").select("id").eq("created_by", f.luca.userId).eq("kind", "dm").maybeSingle()).data?.id ?? "00000000-0000-0000-0000-000000000000");
    await f.cleanup(); if (independentUser) await f.db.auth.admin.deleteUser(independentUser);
  }
});

async function expectReadableReportBox(box: Locator) {
  await expect(box).toBeVisible();
  await expect.poll(() => box.evaluate((el) => {
    const css = getComputedStyle(el); const line = parseFloat(css.lineHeight) || parseFloat(css.fontSize) * 1.5;
    const expected = line * 2 + parseFloat(css.paddingTop) + parseFloat(css.paddingBottom) + parseFloat(css.borderTopWidth) + parseFloat(css.borderBottomWidth);
    return el.getBoundingClientRect().height + 1 >= expected;
  })).toBe(true);
  const initial = await box.evaluate((el) => el.getBoundingClientRect().height);
  await box.fill("First line\nSecond line\nThird line\nFourth line\nFifth line\nSixth line");
  await expect.poll(() => box.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(initial + 20);
  await box.fill("");
  await expect.poll(() => box.evaluate((el, height) => Math.abs(el.getBoundingClientRect().height - height), initial)).toBeLessThanOrEqual(1);
}

test("a switched business session remains bound to its owner through suspension and cookie removal", async ({ browser }) => {
  const f = await planBusinessFixture(); const contexts: BrowserContext[] = []; let businessUser = "";
  try {
    const handle = `managed_${crypto.randomUUID().slice(0, 8)}`;
    const made = await f.db.auth.admin.createUser({ email: `business+${crypto.randomUUID()}@business.agentme.app`, password: f.password, email_confirm: true }); if (made.error) throw made.error; businessUser = made.data.user.id;
    const agent = await f.db.from("agents").insert({ owner_id: businessUser, handle, display_name: "Managed business", type: "business" }).select("id").single(); expect(agent.error).toBeNull();
    await f.db.from("business_managers").insert({ business_agent_id: agent.data!.id, user_id: f.marco.userId, role: "owner" });
    const context = await browser.newContext(); contexts.push(context); const page = await login(context, f.marco.email, f.password);
    await page.getByTestId("identity-switcher").click(); await page.getByTestId(`identity-${handle}`).click(); await expect(page.getByTestId("identity-switcher")).toContainText("Business");
    expect((await f.db.from("managed_identity_sessions").select("person_user").eq("business_user", businessUser)).data).toEqual([{ person_user: f.marco.userId }]);
    await page.getByTestId("identity-switcher").click(); await page.getByTestId(`identity-${f.marco.agent.handle}`).click(); await expect(page.getByTestId("identity-switcher")).toContainText("Personal");
    await page.getByTestId("identity-switcher").click(); await page.getByTestId(`identity-${handle}`).click(); await expect(page.getByTestId("identity-switcher")).toContainText("Business");
    const cleared = await browser.newContext({ storageState: await context.storageState() }); contexts.push(cleared); await cleared.clearCookies({ name: "agentme_person" }); const cookiePage = await cleared.newPage(); await cookiePage.goto("/chats"); await expect(cookiePage).toHaveURL(/\/account-status$/); await expect(cookiePage.getByRole("heading", { name: "Business identity unavailable", exact: true })).toBeVisible();
    expect((await f.db.from("platform_account_sanctions").insert({ user_id: f.marco.userId, user_key: f.marco.userId, subject_name: "Marco", actor_id: f.paul.userId, action: "ban", justification: "Isolated test of a restricted manager's existing session." })).error).toBeNull();
    await expect(page).toHaveURL(/\/account-status$/); await expect(page.getByRole("heading", { name: "Account permanently banned", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Return to my personal account to appeal", exact: true }).click(); await expect(page.getByTestId("own-account-decision")).toContainText("Isolated test"); await expect(page.locator("summary").filter({ hasText: "Appeal this decision" })).toBeVisible();
  } finally {
    await Promise.allSettled(contexts.map((c) => c.close())); await f.db.from("platform_account_sanctions").delete().eq("user_key", f.marco.userId);
    if (businessUser) { await f.db.from("conversations").delete().eq("created_by", businessUser); await f.db.auth.admin.deleteUser(businessUser); }
    await f.cleanup();
  }
});

test("private whole-group reports reach independent platform review, with reversible enforcement and reporter updates", async ({ browser }) => {
  const f = await planBusinessFixture(); const contexts: BrowserContext[] = []; let group = ""; const title = `Platform review example ${crypto.randomUUID().slice(0, 8)}`;
  try {
    const { data } = await f.db.from("conversations").insert({ kind: "group", title, created_by: f.luca.userId }).select("id").single(); group = data!.id;
    expect((await f.db.from("conversation_members").insert([f.luca, f.marco].map((p) => ({ conversation_id: group, user_id: p.userId, role: p === f.luca ? "owner" : "member" })))).error).toBeNull();
    await f.db.from("messages").insert({ conversation_id: group, sender_user_id: f.luca.userId, content: "Shared text explicitly selected as evidence", is_ai_generated: false });
    await f.db.from("messages").insert({ conversation_id: group, sender_user_id: f.marco.userId, content: "PRIVATE_AGENT_TEXT", visible_to: f.marco.userId, is_ai_generated: false });
    expect((await f.db.from("platform_moderators").insert({ user_id: f.paul.userId })).error).toBeNull();
    const session = async () => { const c = await browser.newContext(); contexts.push(c); return c; };
    const marco = await login(await session(), f.marco.email, f.password); await marco.goto(`/groups/${group}`); await marco.getByRole("button", { name: "Report group", exact: true }).click();
    const form = marco.getByRole("region", { name: "Report group", exact: true }); await form.getByLabel("What happened?", { exact: true }).fill("PRIVATE_REPORT_REASON: please review the abusive group behaviour."); await form.getByRole("button", { name: "Select supporting messages", exact: true }).click();
    await expect(form.getByText("Shared text explicitly selected as evidence", { exact: true })).toBeVisible(); await expect(form.getByText("PRIVATE_AGENT_TEXT", { exact: true })).toHaveCount(0); await form.getByRole("checkbox", { name: /Shared text explicitly selected as evidence/ }).check(); await form.getByRole("button", { name: "Review report", exact: true }).click(); await expect(form.getByTestId("report-evidence").locator("time")).toBeVisible(); await form.getByRole("button", { name: "Send report", exact: true }).click();
    await expect(form).toHaveCount(0); await marco.getByRole("link", { name: /^View report/ }).click(); await expect(marco.getByTestId("report-status")).toHaveText("Submitted");
    const reportPath = marco.url(); const { data: report } = await f.db.from("platform_reports").select("case_id").eq("reporter_id", f.marco.userId).single(); const caseId = report!.case_id;
    const luca = await login(await session(), f.luca.email, f.password); await luca.goto(`/moderation/${caseId}`); await expect(luca.getByRole("heading", { name: "404", exact: true })).toBeVisible();
    const paul = await login(await session(), f.paul.email, f.password); await paul.goto("/chats"); await paul.getByRole("link", { name: /My Agent/ }).first().click(); await expect(paul.getByTestId("moderation-attention")).toContainText(/[1-9]\d* (?:case needs|cases need) review/); await paul.getByRole("link", { name: "Review reports", exact: true }).click(); await paul.getByRole("link", { name: new RegExp(title) }).click();
    await expect(paul.getByTestId("platform-report")).toContainText("PRIVATE_REPORT_REASON"); await expect(paul.getByTestId("platform-report")).toContainText("Shared text explicitly selected as evidence"); await expect(paul.getByText("PRIVATE_AGENT_TEXT", { exact: true })).toHaveCount(0);
    const decision = paul.getByRole("form", { name: "Platform decision", exact: true }); await decision.getByRole("button", { name: "Save decision", exact: true }).click(); await expect(marco.getByTestId("report-status")).toHaveText("Under review");
    paul.on("dialog", (dialog) => dialog.accept()); await decision.getByLabel("Action", { exact: true }).selectOption("suspend"); await decision.getByLabel("Justification", { exact: true }).fill("Suspended for repeated harassment."); await decision.getByLabel("Internal review notes", { exact: false }).fill("INTERNAL_NOTE_NOT_FOR_REPORTER"); await decision.getByRole("button", { name: "Save decision", exact: true }).click(); await expect(marco.getByTestId("report-status")).toHaveText("Closed · space suspended"); await expect(marco.getByText("INTERNAL_NOTE_NOT_FOR_REPORTER", { exact: false })).toHaveCount(0);
    await luca.goto("/chats"); await luca.getByRole("link", { name: /My Agent/ }).first().click(); const notice = luca.getByTestId("platform-notification"); await expect(notice).toContainText("Suspended for repeated harassment."); await expect(luca.getByText("PRIVATE_REPORT_REASON", { exact: false })).toHaveCount(0);
    await marco.goto(`/chats/${group}`); await expect(marco.getByTestId("cannot-post")).toContainText("read-only"); await expect(marco.getByRole("textbox", { name: "Message", exact: true })).toHaveCount(0);
    await expect(decision.getByLabel("Action", { exact: true })).toHaveValue("restore"); await decision.getByLabel("Justification", { exact: true }).fill("Restrictions lifted after review."); await decision.getByRole("button", { name: "Save decision", exact: true }).click(); await marco.goto(reportPath); await expect(marco.getByTestId("report-status")).toHaveText("Closed · space restored"); await marco.goto(`/chats/${group}`); await expect(marco.getByRole("textbox", { name: "Message", exact: true })).toBeVisible();
  } finally { await Promise.allSettled(contexts.map((c) => c.close())); if (group) await f.db.from("platform_cases").delete().eq("target_key", group); await f.cleanup(); }
});

test("individual message reports remain local and My Agent links admins directly to the message review area", async ({ browser }) => {
  const f = await planBusinessFixture(); const a = await browser.newContext(); const b = await browser.newContext();
  try {
    const { data: message } = await f.db.from("messages").insert({ conversation_id: f.group, sender_user_id: f.paul.userId, content: "A message needing local review", is_ai_generated: false }).select("id").single();
    const marco = await login(b, f.marco.email, f.password); await marco.goto(`/chats/${f.group}`); const row = marco.locator(`#m-${message!.id}`); await row.getByLabel("Message options", { exact: true }).click(); await row.getByRole("button", { name: /Report/ }).click();
    const dialog = marco.getByRole("dialog", { name: "Report message", exact: true }); await expectReadableReportBox(dialog.getByLabel("What happened?", { exact: true })); await dialog.getByRole("radio", { name: "Report to group admins", exact: true }).check(); await dialog.getByLabel("What happened?", { exact: true }).fill("This message is spam."); await dialog.getByRole("button", { name: "Review report", exact: true }).click(); await dialog.getByRole("button", { name: "Send report", exact: true }).click(); await expect(dialog.getByRole("status")).toContainText("Group admins");
    const luca = await login(a, f.luca.email, f.password); await luca.goto(`/chats/${f.myAgent}`); const updates = luca.getByTestId("moderation-attention"); await expect(updates).toContainText("1 reported message"); await updates.getByRole("link", { name: "Review messages", exact: true }).click(); await expect(luca).toHaveURL(new RegExp(`/groups/${f.group}#reported-messages$`)); const report = luca.getByTestId("report"); await expect(report).toContainText("A message needing local review"); await expect(report).toContainText("This message is spam.");
    expect((await f.db.from("platform_reports").select("id").eq("reporter_id", f.marco.userId)).data).toEqual([]); await report.getByRole("button", { name: "Dismiss", exact: true }).click(); await expect(report).toHaveCount(0);
  } finally { await Promise.allSettled([a.close(), b.close()]); await f.cleanup(); }
});

test("a community member can submit a private platform report and leave while keeping their report receipt", async ({ browser }) => {
  const f = await planBusinessFixture(); const contexts: BrowserContext[] = []; let community = "";
  try {
    const session = async () => { const c = await browser.newContext(); contexts.push(c); return c; };
    const luca = await login(await session(), f.luca.email, f.password); await luca.goto("/communities"); await luca.getByRole("button", { name: /New community/ }).click();
    const create = luca.getByRole("form", { name: "New community", exact: true });
    await create.getByLabel("Name", { exact: false }).fill(`Report ${crypto.randomUUID().slice(0, 8)}`); await create.getByLabel("What is it about?", { exact: false }).fill("A temporary community for testing private platform reporting."); await create.getByRole("button", { name: "Create community", exact: true }).click();
    await expect(luca).toHaveURL(/\/communities\/[0-9a-f-]+$/); community = luca.url().split("/").at(-1)!;
    await luca.getByRole("button", { name: "Report community", exact: true }).click(); const ownerForm = luca.getByRole("region", { name: "Report community", exact: true }); await expect(ownerForm.getByLabel("Also leave this community", { exact: true })).toHaveCount(0); await ownerForm.getByRole("button", { name: "Cancel", exact: true }).click();
    const marco = await login(await session(), f.marco.email, f.password); await marco.goto(`/communities/${community}`); await marco.getByLabel("I accept the rules", { exact: true }).check(); await marco.getByRole("button", { name: "Join community", exact: true }).click();
    await marco.getByRole("button", { name: "Report community", exact: true }).click(); const form = marco.getByRole("region", { name: "Report community", exact: true }); await expectReadableReportBox(form.getByLabel("What happened?", { exact: true })); await form.getByLabel("What happened?", { exact: true }).fill("PRIVATE_COMMUNITY_REPORT_REASON"); await form.getByRole("checkbox", { name: /I don.t have a specific message/ }).check(); await form.getByLabel("Also leave this community", { exact: true }).check(); await form.getByRole("button", { name: "Review report", exact: true }).click(); await form.getByRole("button", { name: "Send report", exact: true }).click();
    await expect(marco).toHaveURL(/\/reports\/[0-9a-f-]+$/); await expect(marco.getByTestId("report-status")).toHaveText("Submitted"); await expect(marco.getByText("PRIVATE_COMMUNITY_REPORT_REASON", { exact: true })).toBeVisible();
    expect((await f.db.from("community_members").select("user_id").eq("community_id", community).eq("user_id", f.marco.userId)).data).toEqual([]);
    expect((await f.db.from("platform_cases").select("target_kind").eq("target_key", community).single()).data!.target_kind).toBe("community");
    await luca.reload(); await expect(luca.getByText("PRIVATE_COMMUNITY_REPORT_REASON", { exact: false })).toHaveCount(0);
  } finally { await Promise.allSettled(contexts.map((c) => c.close())); if (community) { await f.db.from("platform_cases").delete().eq("target_key", community); await f.db.from("communities").delete().eq("id", community); } await f.cleanup(); }
});

test("an operator grants and removes reviewer access inside Settings while other accounts cannot manage staff", async ({ browser }) => {
  const f = await planBusinessFixture(); const contexts: BrowserContext[] = [];
  try {
    expect((await f.db.from("platform_operators").insert({ user_id: f.luca.userId })).error).toBeNull();
    expect((await f.db.from("platform_moderators").insert({ user_id: f.paul.userId })).error).toBeNull();
    const session = async () => { const c = await browser.newContext(); contexts.push(c); return c; };
    const luca = await login(await session(), f.luca.email, f.password); await luca.goto("/settings"); await luca.getByRole("link", { name: /Platform staff/ }).click(); await expect(luca.getByRole("heading", { name: "Platform staff", exact: true })).toBeVisible();
    const paul = await login(await session(), f.paul.email, f.password); await paul.goto("/settings"); await expect(paul.getByRole("link", { name: /Platform staff/ })).toHaveCount(0); await paul.goto("/moderation/staff"); await expect(paul.getByRole("heading", { name: "404", exact: true })).toBeVisible();
    const marco = await login(await session(), f.marco.email, f.password); await marco.goto("/settings"); await expect(marco.getByRole("link", { name: /Platform moderation/ })).toHaveCount(0); await expect(marco.getByRole("link", { name: /Platform staff/ })).toHaveCount(0);
    const form = luca.getByRole("form", { name: "Grant reviewer access", exact: true }); await form.getByLabel("Account email", { exact: true }).fill(f.marco.email); await form.getByRole("button", { name: "Grant access", exact: true }).click(); await expect(form.getByRole("status")).toContainText(`Reviewer access granted to ${f.marco.email}`);
    const member = luca.getByTestId("platform-staff-member").filter({ hasText: f.marco.email }); await expect(member).toContainText("Access enabled"); await expect(marco.getByRole("link", { name: /Platform moderation/ })).toBeVisible(); await expect(marco.getByRole("link", { name: /Platform staff/ })).toHaveCount(0);
    const history = luca.getByRole("region", { name: "Staff access history", exact: true }); await expect(history).toContainText(f.marco.email); await expect(history).toContainText("Luca"); await expect(history.locator("time").first()).toBeVisible();
    luca.on("dialog", (dialog) => dialog.accept()); await member.getByRole("button", { name: "Remove access", exact: true }).click(); await expect(member).toContainText("Access removed"); await expect(marco.getByRole("link", { name: /Platform moderation/ })).toHaveCount(0); await marco.goto("/moderation"); await expect(marco.getByRole("heading", { name: "404", exact: true })).toBeVisible();
    await form.getByLabel("Account email", { exact: true }).fill(f.marco.email); await form.getByRole("button", { name: "Grant access", exact: true }).click(); await expect(member).toContainText("Access enabled"); await marco.goto("/moderation"); await expect(marco.getByRole("heading", { name: "Platform moderation", exact: true })).toBeVisible();
  } finally { await Promise.allSettled(contexts.map((context) => context.close())); await f.db.from("platform_staff_events").delete().eq("actor_id", f.luca.userId); await f.cleanup(); }
});

test("a DM report previews selected context and lets an independent reviewer remove only the reported message", async ({ browser }) => {
  const f = await planBusinessFixture(); const contexts: BrowserContext[] = []; let conversation = "";
  try {
    const { data } = await f.db.from("conversations").insert({ kind: "dm", created_by: f.luca.userId }).select("id").single(); conversation = data!.id;
    await f.db.from("conversation_members").insert([f.luca, f.marco].map((p) => ({ conversation_id: conversation, user_id: p.userId })));
    const { data: message } = await f.db.from("messages").insert({ conversation_id: conversation, sender_user_id: f.luca.userId, content: "A reported discriminatory message", is_ai_generated: false }).select("id").single();
    await f.db.from("messages").insert({ conversation_id: conversation, sender_user_id: f.marco.userId, content: "PRIVATE_AGENT_CONTEXT", visible_to: f.marco.userId, is_ai_generated: false });
    await f.db.from("messages").insert({ conversation_id: conversation, sender_user_id: f.marco.userId, content: "Optional shared surrounding context", is_ai_generated: false });
    await f.db.from("platform_moderators").insert({ user_id: f.paul.userId });
    const session = async () => { const c = await browser.newContext(); contexts.push(c); return c; };
    const marco = await login(await session(), f.marco.email, f.password); await marco.setViewportSize({ width: 390, height: 844 }); await marco.goto(`/chats/${conversation}`); const row = marco.locator(`#m-${message!.id}`); await row.getByLabel("Message options", { exact: true }).click(); await row.getByRole("button", { name: /Report/ }).click();
    const dialog = marco.getByRole("dialog", { name: "Report message", exact: true }); await expectReadableReportBox(dialog.getByLabel("What happened?", { exact: true })); await expect(dialog.getByRole("radio")).toHaveCount(0); await expect(dialog.getByText("PRIVATE_AGENT_CONTEXT", { exact: true })).toHaveCount(0);
    const context = dialog.getByRole("checkbox", { name: /Optional shared surrounding context/ }); await expect(context).not.toBeChecked(); await context.check(); await dialog.getByLabel("Concern", { exact: true }).selectOption("hate"); await dialog.getByLabel("What happened?", { exact: true }).fill("Please review the discriminatory content and the selected context."); await dialog.getByRole("button", { name: "Review report", exact: true }).click();
    await expect(dialog.getByTestId("report-evidence")).toHaveCount(2); await expect(dialog.getByTestId("report-evidence").first().locator("time")).toBeVisible(); await dialog.getByRole("button", { name: "Send report", exact: true }).click(); await dialog.getByRole("link", { name: /^View report/ }).click(); await expect(marco.getByTestId("report-status")).toHaveText("Submitted");
    const { data: report } = await f.db.from("platform_reports").select("case_id").eq("reporter_id", f.marco.userId).single();
    const paul = await login(await session(), f.paul.email, f.password); await paul.goto(`/moderation/${report!.case_id}`); await expect(paul.getByTestId("platform-report")).toContainText("Optional shared surrounding context"); await expect(paul.getByText("PRIVATE_AGENT_CONTEXT", { exact: true })).toHaveCount(0); await expect(paul.getByRole("link", { name: "Open chat", exact: true })).toHaveCount(0);
    const decision = paul.getByRole("form", { name: "Platform decision", exact: true }); await decision.getByLabel("Action", { exact: true }).selectOption("remove"); await decision.getByLabel("Justification", { exact: true }).fill("The reported message was removed following review."); paul.on("dialog", (d) => d.accept()); await decision.getByRole("button", { name: "Save decision", exact: true }).click(); await expect(marco.getByTestId("report-status")).toHaveText("Closed · message removed");
    expect((await f.db.from("messages").select("removed_at").eq("id", message!.id).single()).data!.removed_at).toBeTruthy(); expect((await f.db.from("conversations").select("platform_suspended").eq("id", conversation).single()).data!.platform_suspended).toBe(false);
  } finally { await Promise.allSettled(contexts.map((c) => c.close())); if (conversation) await f.db.from("platform_cases").delete().eq("source_conversation", conversation); await f.cleanup(); }
});

test("a reviewer requests more evidence through My Agent and the reporter previews an additional message before sharing it", async ({ browser }) => {
  const f = await planBusinessFixture(); const contexts: BrowserContext[] = []; let group = "";
  try {
    const { data } = await f.db.from("conversations").insert({ kind: "group", title: "Evidence follow-up example", description: "Original group information", created_by: f.luca.userId }).select("id").single(); group = data!.id;
    await f.db.from("conversation_members").insert([f.luca, f.marco].map((p) => ({ conversation_id: group, user_id: p.userId, role: p === f.luca ? "owner" : "member" })));
    await f.db.from("messages").insert({ conversation_id: group, sender_user_id: f.luca.userId, content: "An example selected in the follow-up reply", is_ai_generated: false });
    await f.db.from("platform_moderators").insert({ user_id: f.paul.userId });
    const session = async () => { const c = await browser.newContext(); contexts.push(c); return c; };
    const marco = await login(await session(), f.marco.email, f.password); await marco.goto(`/groups/${group}`); await marco.getByRole("button", { name: "Report group", exact: true }).click(); const form = marco.getByRole("region", { name: "Report group", exact: true }); await form.getByLabel("What happened?", { exact: true }).fill("Please investigate the group's purpose."); await form.getByRole("checkbox", { name: /I don.t have a specific message/ }).check(); await form.getByRole("button", { name: "Review report", exact: true }).click(); await expect(form).toContainText("Original group information"); await form.getByRole("button", { name: "Send report", exact: true }).click(); await marco.getByRole("link", { name: /^View report/ }).click();
    const { data: report } = await f.db.from("platform_reports").select("case_id").eq("reporter_id", f.marco.userId).single(); const paul = await login(await session(), f.paul.email, f.password); await paul.goto(`/moderation/${report!.case_id}`); await paul.getByRole("button", { name: "Request more evidence", exact: true }).click();
    const request = paul.getByRole("form", { name: "Request more evidence", exact: true }); await request.getByLabel("What should the reporter provide?", { exact: true }).fill("Please share a specific message showing the concern."); await request.getByRole("button", { name: "Send request", exact: true }).click(); await expect(paul.getByTestId("platform-report")).toContainText("Waiting for reporter");
    await marco.goto("/chats"); await marco.getByRole("link", { name: /My Agent/ }).first().click(); const attention = marco.getByTestId("evidence-attention"); await expect(attention).toContainText("Please share a specific message showing the concern."); await attention.getByRole("link", { name: "Reply to request", exact: true }).click(); await expect(marco.getByTestId("report-status")).toHaveText("Waiting for more evidence");
    const answer = marco.getByRole("region", { name: "Reply with more evidence", exact: true }); await answer.getByLabel("Your explanation", { exact: true }).fill("Here is a specific example I chose to share."); await answer.getByRole("button", { name: "Select supporting messages", exact: true }).click(); await answer.getByRole("checkbox", { name: /An example selected in the follow-up reply/ }).check(); await answer.getByRole("button", { name: "Review reply", exact: true }).click(); await expect(answer.getByTestId("report-evidence")).toContainText("An example selected in the follow-up reply"); await answer.getByRole("button", { name: "Send evidence reply", exact: true }).click(); await expect(marco.getByTestId("report-status")).toHaveText("Under review");
    await expect(paul.getByTestId("platform-report")).toContainText("Here is a specific example I chose to share."); await expect(paul.getByTestId("platform-report")).toContainText("An example selected in the follow-up reply");
    await marco.goto("/chats"); await marco.getByRole("link", { name: /My Agent/ }).first().click(); await expect(marco.getByTestId("evidence-attention")).toHaveCount(0);
  } finally { await Promise.allSettled(contexts.map((c) => c.close())); if (group) await f.db.from("platform_cases").delete().eq("target_key", group); await f.cleanup(); }
});
