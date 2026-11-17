import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { config } from "dotenv";
import { businessStaffFixture } from "../tests/fixtures/business-staff";
config({ path: ".env.local", quiet: true });

async function setup() {
  const f = await businessStaffFixture();
  const members = await f.db.from("business_managers").insert([{ business_agent_id: f.business.agent.id, user_id: f.marco.userId, role: "manager" }, { business_agent_id: f.business.agent.id, user_id: f.paul.userId, role: "staff", supervisor_id: f.marco.userId }]); if (members.error) throw members.error;
  const home = await f.db.from("conversations").insert({ kind: "my_agent", created_by: f.business.userId }).select("id").single(); if (home.error) throw home.error;
  await f.db.from("conversation_members").insert({ conversation_id: home.data.id, user_id: f.business.userId, role: "owner" });
  return { ...f, home: home.data.id };
}
async function login(page: Page, f: Awaited<ReturnType<typeof setup>>, email: string) {
  await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(f.password); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(/\/chats/);
  await page.getByTestId("identity-switcher").click(); await page.getByTestId(`identity-${f.business.agent.handle}`).click(); await expect(page.getByTestId("identity-switcher")).toContainText(f.business.agent.handle);
}
async function openControls(page: Page) {
  await page.goto("/business"); const section = page.getByTestId("fold-staff"); await section.locator("summary").first().click();
  const row = section.getByRole("list", { name: "Business team", exact: true }).getByRole("listitem").filter({ hasText: "Paul" });
  const controls = row.getByTestId("staff-controls"); await controls.locator("summary").click(); return controls;
}

test("publication review explains irrelevant/private answers, records the reason and accepts an edited general FAQ", async ({ browser }) => {
  const f = await setup(); const context = await browser.newContext();
  try {
    const staff = await f.signed(f.paul, true); const question = "Can you securely store a cello in a locked room while we have dinner?";
    const draft = await staff.rpc("suggest_business_answer", { p_question: question, p_answer: "Yes, we do have a purple cello." }); expect(draft.error).toBeNull();
    const page = await context.newPage(); await login(page, f, f.marco.email); await page.goto(`/chats/${f.home}`);
    const review = page.getByTestId("business-answer-review"); await expect(review).toBeVisible();
    await review.getByRole("button", { name: "Approve & publish", exact: true }).click();
    await expect(review.getByRole("alert")).toContainText("the answer does not answer the FAQ question");
    expect((await f.db.from("business_answer_drafts").select("status").eq("id", draft.data!).single()).data?.status).toBe("pending");
    expect((await f.db.from("business_staff_audit").select("action").eq("business_agent_id", f.business.agent.id).like("action", "Q&A publication check: not_answered%" )).data).toHaveLength(1);
    await review.getByLabel("Review question", { exact: true }).fill("Do you offer secure cello storage?"); await review.getByLabel("Review answer", { exact: true }).fill("We store cellos in a locked room during meals."); await review.getByRole("button", { name: "Approve & publish", exact: true }).click(); await expect(review).toHaveCount(0);
    const saved = await f.db.from("business_answer_drafts").select("question,answer,status").eq("id", draft.data!).single(); expect(saved.data).toMatchObject({ question: "Do you offer secure cello storage?", status: "approved" });
    const privateDraft = await staff.rpc("suggest_business_answer", { p_question: "Who is coming to our dinner?", p_answer: "Luca and Marco." }); expect(privateDraft.error).toBeNull();
    await expect(review).toBeVisible(); await review.getByRole("button", { name: "Approve & publish", exact: true }).click(); await expect(review.getByRole("alert")).toContainText("private plans or customer-specific details");
    await review.getByRole("button", { name: "Decline suggestion", exact: true }).click(); await expect(review).toHaveCount(0);
  } finally { await context.close(); await f.cleanup(); }
});

test("Manager controls assignment and Q&A approval per Staff member, retaining explicit publication choice", async ({ browser }) => {
  test.setTimeout(240_000);
  const f = await setup(); const contexts: BrowserContext[] = [];
  const question = async (text: string) => { const result = await f.db.from("inbox_items").insert({ owner_id: f.business.userId, agent_id: f.business.agent.id, from_agent: f.luca.agent.id, kind: "question", payload: { kind: "question", business: true, faq_eligible: true, question: text } }).select("id").single(); expect(result.error).toBeNull(); return result.data!.id; };
  const info = async () => ((await f.db.from("agents").select("business_info").eq("id", f.business.agent.id).single()).data!.business_info as { faqs: { q: string; a: string }[] }).faqs;
  try {
    const managerContext = await browser.newContext(); contexts.push(managerContext); const manager = await managerContext.newPage(); await login(manager, f, f.marco.email);
    await manager.setViewportSize({ width: 390, height: 844 }); const controls = await openControls(manager); expect(await manager.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); const assignment = controls.getByRole("switch", { name: "Require assignment before replying", exact: true }); const approval = controls.getByRole("switch", { name: "Require approval before publishing to Q&A", exact: true });
    await expect(assignment).not.toBeChecked(); await expect(approval).toBeChecked(); await controls.getByText("Require assignment before replying", { exact: true }).click(); await expect(assignment).toBeChecked(); await controls.getByRole("button", { name: "Save permissions", exact: true }).click(); await expect(controls.getByRole("status")).toContainText("Permissions saved");
    const staffContext = await browser.newContext(); contexts.push(staffContext); const staff = await staffContext.newPage(); await login(staff, f, f.paul.email); await staff.goto(`/chats/${f.home}`);
    await question("Do you offer secure cello storage?"); await expect(staff.getByTestId("inbox-item")).toHaveCount(0);
    await manager.goto(`/chats/${f.home}`); const request = manager.getByTestId("inbox-item").filter({ hasText: "cello storage" }); await request.getByRole("combobox", { name: "Assign customer question", exact: true }).selectOption(f.paul.userId);
    const assigned = staff.getByTestId("inbox-item").filter({ hasText: "cello storage" }); await expect(assigned).toBeVisible(); await assigned.getByLabel(/Your answer/).fill("We store cellos in a locked room during meals."); await assigned.getByRole("checkbox", { name: "Suggest this as a reusable answer for approval", exact: true }).check(); await assigned.getByRole("button", { name: "Send answer", exact: true }).click(); await expect(assigned).toHaveCount(0);
    const review = manager.getByTestId("business-answer-review"); await expect(review).toBeVisible(); expect((await info()).some((faq) => faq.q === "Do you offer secure cello storage?")).toBe(false);
    await review.getByRole("button", { name: "Approve & publish", exact: true }).click(); await expect(review).toHaveCount(0);
    const changed = await openControls(manager); await changed.getByText("Require assignment before replying", { exact: true }).click(); await changed.getByText("Require approval before publishing to Q&A", { exact: true }).click(); await expect(changed.getByRole("switch", { name: "Require assignment before replying", exact: true })).not.toBeChecked(); await expect(changed.getByRole("switch", { name: "Require approval before publishing to Q&A", exact: true })).not.toBeChecked(); await changed.getByRole("button", { name: "Save permissions", exact: true }).click(); await expect(changed.getByRole("status")).toContainText("Permissions saved");
    await question("Do you have a hearing loop?"); const hearing = staff.getByTestId("inbox-item").filter({ hasText: "hearing loop" }); await expect(hearing).toBeVisible(); const add = hearing.getByRole("checkbox", { name: "Add this to Questions & Answers", exact: true }); await expect(add).not.toBeChecked();
    await hearing.getByLabel(/Your answer/).fill("We have a hearing loop in our dining room."); await hearing.getByRole("button", { name: "Send answer", exact: true }).click(); await expect(hearing).toHaveCount(0); expect((await info()).some((faq) => faq.q === "Do you have a hearing loop?")).toBe(false);
    await question("Can you store bicycles securely?"); const bikes = staff.getByTestId("inbox-item").filter({ hasText: "bicycles securely" }); await expect(bikes).toBeVisible(); await bikes.getByLabel(/Your answer/).fill("We can securely store four bicycles indoors during meals."); await bikes.getByRole("checkbox", { name: "Add this to Questions & Answers", exact: true }).check(); await bikes.getByRole("button", { name: "Send answer", exact: true }).click(); await expect(bikes).toHaveCount(0);
    expect((await info()).some((faq) => faq.q === "Can you store bicycles securely?")).toBe(true);
    await question("Can you store a cello securely?"); const purple = staff.getByTestId("inbox-item").filter({ hasText: "a cello securely" }); await expect(purple).toBeVisible(); await purple.getByLabel(/Your answer/).fill("Yes, we have a purple cello."); await purple.getByRole("checkbox", { name: "Add this to Questions & Answers", exact: true }).check(); await purple.getByRole("button", { name: "Send answer", exact: true }).click(); await expect(purple.getByRole("alert")).toContainText("Your customer reply has not been sent");
    expect((await info()).some((faq) => /purple cello/i.test(faq.a))).toBe(false);
    await purple.getByRole("checkbox", { name: "Add this to Questions & Answers", exact: true }).uncheck(); await purple.getByRole("button", { name: "Send answer", exact: true }).click(); await expect(purple).toHaveCount(0);
    expect((await f.db.from("inbox_items").select("id").eq("owner_id", f.business.userId).eq("kind", "business_answer_review").eq("status", "open")).data).toEqual([]);
    await staff.setViewportSize({ width: 390, height: 844 }); await staff.goto("/business"); const staffSection = staff.getByTestId("fold-staff"); await staffSection.locator("summary").first().click(); await expect(staffSection.getByRole("switch")).toHaveCount(0); expect(await staff.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await Promise.allSettled(contexts.map((context) => context.close())); await f.cleanup(); }
});
