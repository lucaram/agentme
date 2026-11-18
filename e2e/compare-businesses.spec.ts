import { expect, test, type BrowserContext } from "@playwright/test";
import { planBusinessFixture } from "../tests/fixtures/plan-business";

/**
 * Comparing businesses from My Agent: the same points go to each business's agent, and the
 * answers come back on one card with a summary worked out in code, and "Open" / "Plan it here".
 * Isolated users and businesses; never the demo accounts.
 */
test("compare two businesses on price and parking, then plan it at the cheaper one", async ({ browser }) => {
  const f = await planBusinessFixture(); const sessions: BrowserContext[] = [];
  const handle = `${f.business.agent.handle.slice(0, 12)}_b`;
  let secondUser: string | null = null;
  try {
    // Two businesses with what they published: prices, parking, and a booking button.
    await f.db.from("agents").update({ business_info: { ...(f.business.agent.business_info as object), faqs: [{ q: "How much is a margherita pizza?", a: "A margherita is £8.50 (12-inch)." }, { q: "Do you have parking?", a: "Yes, a free car park behind the restaurant." }] } }).eq("id", f.business.agent.id);
    const { data: created, error } = await f.db.auth.admin.createUser({ email: `${handle}@agentme.test`, password: f.password, email_confirm: true });
    if (error) throw error;
    secondUser = created.user.id;
    await f.db.from("agents").insert({ owner_id: secondUser, handle, display_name: "Pizza Napoli", type: "business", contact_policy: "anyone", business_info: { faqs: [{ q: "How much is a margherita pizza?", a: "Our margherita costs £9 (10-inch)." }, { q: "Do you have parking?", a: "No parking, street parking only." }] } });

    const context = await browser.newContext(); sessions.push(context); const page = await context.newPage();
    await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(f.luca.email); await page.getByLabel("Password", { exact: true }).fill(f.password); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(/\/chats/);
    await page.goto(`/chats/${f.myAgent}?t=new`);
    const box = page.getByRole("textbox", { name: "Message", exact: true });
    await box.fill(`Which of @${f.business.agent.handle} and @${handle} has the cheapest margherita pizza, and who has parking?`);
    await page.getByRole("button", { name: "Send", exact: true }).click();

    const card = page.getByTestId("comparison-card");
    await expect(card.getByTestId("comparison-summary")).toContainText("Cheapest stated margherita pizza: Trattoria Sole (£8.50). Sizes may differ.", { timeout: 45_000 });
    await expect(card.getByTestId("comparison-summary")).toContainText("Parking: only Trattoria Sole says yes.");
    await expect(card.getByTestId("comparison-business").filter({ hasText: "Pizza Napoli" })).toContainText("✗ ");

    // "Open" shows the business's own buttons; "Plan it here" starts the request in the box.
    const sole = card.getByTestId("comparison-business").filter({ hasText: "Trattoria Sole" });
    await sole.getByRole("button", { name: "Open ▸" }).click();
    await sole.getByRole("button", { name: "Plan it here" }).click();
    await expect(box).toHaveValue(`Organise a visit to @${f.business.agent.handle} with `);
    await expect(box).toBeFocused();
  } finally {
    for (const session of sessions) await session.close();
    if (secondUser) await f.db.auth.admin.deleteUser(secondUser);
    await f.cleanup();
  }
});
