import { expect, test, type Page } from "@playwright/test";
import { config } from "dotenv";
import { businessStaffFixture } from "../tests/fixtures/business-staff";
config({ path: ".env.local", quiet: true });

async function login(page: Page, email: string, password: string) {
  await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(password); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(/\/chats/);
}

test("account decisions identify personal and business accounts and return active users to Settings", async ({ browser }) => {
  const f = await businessStaffFixture(); const context = await browser.newContext();
  try {
    const page = await context.newPage(); await login(page, f.luca.email, f.password); await page.goto("/settings"); await page.getByRole("link", { name: /Account decisions/ }).click();
    await expect(page.getByRole("heading", { name: "Account decisions", exact: true })).toBeVisible(); await expect(page.getByTestId("account-decision-identity")).toContainText(`@${f.luca.agent.handle}`); await expect(page.getByTestId("account-decision-identity")).toContainText("Personal");
    await expect(page.getByRole("heading", { name: "Your account is active", exact: true })).toBeVisible(); await expect(page.getByText("No active restrictions.", { exact: true })).toBeVisible(); await expect(page.getByText("No account decisions to display.", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Return to AGENTME", exact: true })).toHaveCount(0); await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: "test-results/account-decisions-personal-mobile.png", fullPage: true });
    await page.emulateMedia({ colorScheme: "dark" }); await page.screenshot({ path: "test-results/account-decisions-personal-dark.png", fullPage: true });
    await page.getByRole("link", { name: /Settings$/ }).click(); await expect(page).toHaveURL(/\/settings$/);
    await page.getByRole("button", { name: "Log out", exact: true }).click(); await login(page, f.business.email, f.password); await page.goto("/account-status");
    await expect(page.getByTestId("account-decision-identity")).toContainText("Trattoria Sole"); await expect(page.getByTestId("account-decision-identity")).toContainText("Business"); await page.getByRole("link", { name: /Settings$/ }).click(); await expect(page).toHaveURL(/\/settings$/);
  } finally { await context.close(); await f.cleanup(); }
});

test("decision history collapses older records, labels lifted/expired appeals and paginates", async ({ page }) => {
  const f = await businessStaffFixture();
  try {
    const rows = Array.from({ length: 26 }, (_, index) => ({ user_id: f.luca.userId, user_key: f.luca.userId, subject_name: "Luca", actor_id: f.paul.userId, action: "suspend_1m", justification: `Historical decision ${index + 1}`, created_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(), expires_at: "2026-03-01T00:00:00Z", ...(index === 25 ? { revoked_at: "2026-03-02T00:00:00Z", revoke_reason: "Lifted after independent review." } : {}) }));
    const saved = await f.db.from("platform_account_sanctions").insert(rows).select("id,justification"); expect(saved.error).toBeNull();
    const id = (n: number) => saved.data!.find((row) => row.justification === `Historical decision ${n}`)!.id;
    expect((await f.db.from("platform_account_appeals").insert([{ sanction_id: id(26), user_key: f.luca.userId, reason: "Please reconsider the context.", status: "accepted", response: "The restriction was lifted.", reviewed_at: "2026-03-02T00:00:00Z", reviewed_by: f.paul.userId }, { sanction_id: id(25), user_key: f.luca.userId, reason: "Awaiting review of further context.", status: "open" }, { sanction_id: id(24), user_key: f.luca.userId, reason: "A previous appeal.", status: "rejected", response: "The decision was upheld.", reviewed_at: "2026-03-02T00:00:00Z", reviewed_by: f.paul.userId }])).error).toBeNull();
    await login(page, f.luca.email, f.password); await page.goto("/account-status"); const cards = page.getByTestId("own-account-decision"); await expect(cards).toHaveCount(25); await expect(cards.first()).not.toHaveAttribute("open");
    const lifted = page.locator(`#decision-${id(26)}`); await expect(lifted).toContainText("Lifted"); await expect(lifted).toContainText("Appeal accepted"); await lifted.locator("summary").first().click(); await expect(lifted.getByText("Lifted after independent review.", { exact: true })).toBeVisible(); await expect(lifted.getByRole("region", { name: "Your appeal", exact: true })).toContainText("The restriction was lifted.");
    await expect(page.locator(`#decision-${id(25)}`)).toContainText("Appeal under review"); await expect(page.locator(`#decision-${id(24)}`)).toContainText("Appeal rejected"); await expect(cards.nth(3)).toContainText("Expired");
    await page.getByRole("link", { name: "Older decisions", exact: true }).click(); await expect(page).toHaveURL(/page=1/); await expect(cards).toHaveCount(1); await expect(cards.first()).toContainText("Historical decision 1"); await page.getByRole("link", { name: "Newer decisions", exact: true }).click(); await expect(cards).toHaveCount(25);
  } finally { await f.db.from("platform_account_sanctions").delete().eq("user_key", f.luca.userId); await f.cleanup(); }
});

test("restricted business access keeps the owner's personal decision and appeal reachable", async ({ page }) => {
  const f = await businessStaffFixture();
  try {
    expect((await f.db.from("business_managers").insert({ business_agent_id: f.business.agent.id, user_id: f.marco.userId, role: "manager" })).error).toBeNull();
    await login(page, f.marco.email, f.password); await page.getByTestId("identity-switcher").click(); await page.getByTestId(`identity-${f.business.agent.handle}`).click(); await expect(page.getByTestId("identity-switcher")).toContainText(f.business.agent.handle);
    expect((await f.db.from("platform_account_sanctions").insert({ user_id: f.marco.userId, user_key: f.marco.userId, subject_name: "Marco", actor_id: f.paul.userId, action: "ban", justification: "Isolated decision concerning the human account." })).error).toBeNull();
    await page.goto("/account-status"); await expect(page.getByRole("heading", { name: "Business access restricted", exact: true })).toBeVisible(); await expect(page.getByTestId("account-decision-identity")).toContainText("Trattoria Sole"); await expect(page.getByRole("link", { name: /Settings$/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Return to my personal account to appeal", exact: true }).click(); await expect(page.getByTestId("account-decision-identity")).toContainText("Marco"); await expect(page.getByRole("heading", { name: "Account permanently banned", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Review decision & appeal", exact: true }).click(); const own = page.getByTestId("own-account-decision"); await expect(own).toHaveAttribute("open"); await own.locator("summary").filter({ hasText: "Appeal this decision" }).click();
    const form = own.getByRole("form", { name: "Account appeal", exact: true }); await form.getByLabel("Why should this decision be reconsidered?", { exact: true }).fill("Please review the surrounding context of this decision."); await form.getByRole("button", { name: "Submit appeal", exact: true }).click(); await expect(own).toContainText("Appeal submitted"); await expect(own).toContainText("Appeal under review");
    await page.goto("/settings"); await expect(page).toHaveURL(/\/account-status$/); await expect(page.getByRole("link", { name: /Settings$/ })).toHaveCount(0);
  } finally { await f.db.from("platform_account_sanctions").delete().eq("user_key", f.marco.userId); await f.cleanup(); }
});
