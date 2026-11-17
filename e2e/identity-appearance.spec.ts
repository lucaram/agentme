import { expect, test, type Page } from "@playwright/test";
import { config } from "dotenv";
import { businessStaffFixture } from "../tests/fixtures/business-staff";
config({ path: ".env.local", quiet: true });

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/chats/);
}
async function switchTo(page: Page, handle: string) {
  await page.getByTestId("identity-switcher").click();
  await page.getByTestId(`identity-${handle}`).click();
  await expect(page.getByTestId("identity-switcher")).toContainText(`@${handle}`);
}
async function select(page: Page, name: string) {
  await page.getByRole("radio", { name, exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
}

test("personal and business appearances restore on switching, first render, reload and another device", async ({ browser }) => {
  const f = await businessStaffFixture();
  const context = await browser.newContext();
  const other = await browser.newContext();
  try {
    expect((await f.db.from("business_managers").insert({ business_agent_id: f.business.agent.id, user_id: f.marco.userId, role: "owner" })).error).toBeNull();
    const page = await context.newPage();
    await login(page, f.marco.email, f.password);
    await page.goto("/settings/personalise");
    await select(page, "Dark"); await select(page, "Purple"); await select(page, "Large"); await select(page, "Black");
    await switchTo(page, f.business.agent.handle);
    await page.goto("/settings/personalise");
    await select(page, "Light"); await select(page, "Blue"); await select(page, "Extra large"); await select(page, "Tinted");
    await switchTo(page, f.marco.agent.handle);
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-accent", "purple");
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(html).toHaveAttribute("data-text", "large");
    await expect(html).toHaveAttribute("data-dark", "black");
    await expect(html).toHaveAttribute("data-tint", "plain");
    await switchTo(page, f.business.agent.handle);
    await expect(html).toHaveAttribute("data-accent", "blue");
    await expect(html).toHaveAttribute("data-theme", "light");
    await expect(html).toHaveAttribute("data-text", "xl");
    await expect(html).toHaveAttribute("data-tint", "tinted");
    await page.goto("/settings/personalise");
    await page.reload(); await expect(html).toHaveAttribute("data-accent", "blue");
    // A stale device cookie cannot override the selected identity on the first paint.
    await context.addCookies([{ name: "agentme_look", value: "dark.orange.standard.dim.plain", url: "http://localhost:3001" }]);
    const response = await context.request.get("/settings/personalise");
    expect(await response.text()).toMatch(/<html[^>]*data-theme="light"[^>]*data-accent="blue"/);
    await page.reload(); await expect(html).toHaveAttribute("data-accent", "blue");
    await expect(page.getByRole("radio", { name: "Blue", exact: true })).toBeChecked();
    await page.getByRole("link", { name: "Settings", exact: true }).first().click();
    await expect(page.getByTestId("personalise-link")).toContainText("Blue");
    const device = await other.newPage(); await login(device, f.marco.email, f.password);
    await expect(device.locator("html")).toHaveAttribute("data-accent", "purple");
    await switchTo(device, f.business.agent.handle);
    await expect(device.locator("html")).toHaveAttribute("data-accent", "blue");
  } finally { await context.close(); await other.close(); await f.cleanup(); }
});

test("Manager and Staff can customise the same business independently", async ({ browser }) => {
  const f = await businessStaffFixture();
  const managerContext = await browser.newContext();
  const staffContext = await browser.newContext();
  const ownerContext = await browser.newContext();
  try {
    expect((await f.db.from("business_managers").insert([
      { business_agent_id: f.business.agent.id, user_id: f.marco.userId, role: "manager" },
      { business_agent_id: f.business.agent.id, user_id: f.paul.userId, role: "staff", supervisor_id: f.marco.userId },
    ])).error).toBeNull();
    const manager = await managerContext.newPage(); await login(manager, f.marco.email, f.password);
    await switchTo(manager, f.business.agent.handle); await manager.goto("/settings/personalise"); await select(manager, "Orange");
    const staff = await staffContext.newPage(); await login(staff, f.paul.email, f.password);
    await switchTo(staff, f.business.agent.handle); await staff.goto("/settings/personalise");
    await expect(staff.locator("html")).toHaveAttribute("data-accent", "green"); await select(staff, "Teal");
    await manager.reload(); await expect(manager.locator("html")).toHaveAttribute("data-accent", "orange");
    const owner = await ownerContext.newPage(); await login(owner, f.business.email, f.password);
    await expect(owner.locator("html")).toHaveAttribute("data-accent", "green");
    await switchTo(staff, f.paul.agent.handle); await expect(staff.locator("html")).toHaveAttribute("data-accent", "green");
    await switchTo(staff, f.business.agent.handle); await expect(staff.locator("html")).toHaveAttribute("data-accent", "teal");
    // Working for the business, the menu still names the person who signed in.
    await staff.getByTestId("identity-switcher").click(); await expect(staff.getByTestId("signed-in-as")).toHaveText(`Signed in as ${f.paul.email}`);
    await staff.getByRole("menuitem", { name: "Log out", exact: true }).click(); await expect(staff).toHaveURL(/\/login/);
    await login(staff, f.paul.email, f.password); await expect(staff.locator("html")).toHaveAttribute("data-accent", "green");
  } finally { await managerContext.close(); await staffContext.close(); await ownerContext.close(); await f.cleanup(); }
});
