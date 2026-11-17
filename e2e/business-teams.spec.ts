import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { config } from "dotenv";
import { businessTeamsFixture } from "../tests/fixtures/business-teams";
config({ path: ".env.local", quiet: true });

test("Staff transfers require recipient acceptance in My Agent; dashboards enforce team scope", async ({ browser }) => {
  test.setTimeout(300_000);
  const f = await businessTeamsFixture(); const contexts: BrowserContext[] = [];
  async function login(email: string, work = true) {
    const context = await browser.newContext(); contexts.push(context); const page = await context.newPage();
    await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(f.password); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(/\/chats/);
    if (work) { await page.getByTestId("identity-switcher").click(); await page.getByTestId(`identity-${f.business.agent.handle}`).click(); await expect(page.getByTestId("identity-switcher")).toContainText(f.business.agent.handle); }
    return page;
  }
  const line = async () => (await f.db.from("business_managers").select("supervisor_id").eq("business_agent_id", f.business.agent.id).eq("user_id", f.luca.userId).single()).data?.supervisor_id;
  async function teamRow(page: Page, name: string) {
    await page.goto("/business"); const section = page.getByTestId("fold-staff");
    const summary = section.locator("summary").first(); if ((await section.getAttribute("open")) === null) await summary.click();
    return section.getByRole("list", { name: "Business team", exact: true }).getByRole("listitem").filter({ hasText: name });
  }
  try {
    const receiving = await login(f.paul.email); await receiving.goto(`/chats/${f.businessChat}`);
    const requesting = await login(f.marco.email); const row = await teamRow(requesting, "Luca");
    await expect(row).toContainText("Reports to: Marco"); await row.getByText("Move Staff to another supervisor", { exact: true }).click();
    await row.getByRole("combobox", { name: "Receiving supervisor", exact: true }).fill(`@${f.paul.agent.handle}`); await row.getByRole("option", { name: /Paul/ }).click();
    await row.getByRole("button", { name: "Request transfer", exact: true }).click(); await expect(row.getByTestId("pending-staff-transfer")).toContainText("Awaiting acceptance"); expect(await line()).toBe(f.marco.userId);
    const card = receiving.getByTestId("staff-transfer-request"); await expect(card).toContainText("Accept Luca into your team?");
    await requesting.goto(`/chats/${f.businessChat}`); await expect(requesting.getByTestId("staff-transfer-request")).toHaveCount(0);
    await card.getByRole("button", { name: "Accept transfer", exact: true }).click(); await expect(card).toHaveCount(0); await expect.poll(line).toBe(f.paul.userId);
    await expect(requesting.getByTestId("business-work-notice")).toContainText("Luca now reports to Paul");
    await expect((await teamRow(requesting, "Luca")).getByRole("button", { name: "Remove access", exact: true })).toHaveCount(0);
    await receiving.goto("/business#customer-dashboard"); const managerDashboard = receiving.getByTestId("fold-activity"); await expect(managerDashboard.getByTestId("team-performance")).toBeVisible();
    const filters = managerDashboard.getByRole("form", { name: "Dashboard filters" });
    await expect(filters.getByRole("option", { name: "Entire business", exact: true })).toHaveCount(0);
    await filters.getByLabel("View performance").selectOption("person"); await filters.getByRole("combobox", { name: "Filter by Staff member", exact: true }).fill(`@${f.luca.agent.handle}`); await filters.getByRole("option", { name: /Luca/ }).click(); await filters.getByRole("button", { name: "Apply filters", exact: true }).click();
    await expect(receiving).toHaveURL((url) => url.searchParams.get("scope") === "person" && url.searchParams.get("person") === f.luca.userId); await expect(receiving.getByTestId("team-performance")).toBeVisible();
    await receiving.goto(`/business?scope=team&person=${f.marco.userId}#customer-dashboard`); await expect(receiving.getByTestId("fold-activity").getByRole("alert")).toContainText("This dashboard view is unavailable");
    const owner = await login(f.business.email, false); await owner.goto("/business#customer-dashboard");
    const ownerFilters = owner.getByRole("form", { name: "Dashboard filters" }); await ownerFilters.getByLabel("View performance").selectOption("team");
    await ownerFilters.getByRole("combobox", { name: "Filter by supervisor", exact: true }).fill(`@${f.paul.agent.handle}`); await ownerFilters.getByRole("option", { name: /Paul/ }).click(); await ownerFilters.getByRole("button", { name: "Apply filters", exact: true }).click();
    await expect(owner).toHaveURL((url) => url.searchParams.get("scope") === "team" && url.searchParams.get("person") === f.paul.userId); await expect(owner.getByTestId("team-performance")).toBeVisible();
    await owner.setViewportSize({ width: 390, height: 844 }); expect(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const oldManager = await teamRow(owner, "Marco"); await oldManager.getByRole("button", { name: "Remove access", exact: true }).click(); await owner.getByRole("dialog").getByRole("button", { name: "Confirm change", exact: true }).click();
    await expect.poll(async () => (await f.db.from("business_managers").select("user_id").eq("business_agent_id", f.business.agent.id).eq("user_id", f.marco.userId)).data).toEqual([]);
    await expect(requesting).toHaveURL(/\/login\?reason=business-access/);
  } finally { await Promise.allSettled(contexts.map((context) => context.close())); await f.cleanup(); }
});
