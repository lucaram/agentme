import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { config } from "dotenv";
import { onboardingFixture } from "../tests/fixtures/onboarding";
import { businessStaffFixture } from "../tests/fixtures/business-staff";
config({ path: ".env.local", quiet: true });

async function login(page: Page, email: string, password: string) {
  await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(password); await page.getByRole("button", { name: "Log in", exact: true }).click();
}
const photo = async () => ({ name: "photo.png", mimeType: "image/png", buffer: await sharp({ create: { width: 1000, height: 600, channels: 4, background: "#bd325d" } }).png().toBuffer() });
async function choose(page: Page) { await page.getByLabel("Choose avatar image", { exact: true }).setInputFiles(await photo()); const dialog = page.getByRole("dialog", { name: "Customise avatar", exact: true }); await expect(dialog.getByRole("button", { name: "Use image", exact: true })).toBeEnabled(); return dialog; }

test("personal signup and profile use the same editor; changes publish only on Save", async ({ page }) => {
  test.setTimeout(180_000); const f = await onboardingFixture();
  try {
    const user = await f.user(); await login(page, user.email, f.password); await expect(page).toHaveURL(/\/onboarding/);
    await page.getByLabel("Your name").fill(`Avatar ${f.tag}`); await page.getByTestId("avatar-choice").locator("summary").click();
    let editor = await choose(page); await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByAltText("Selected avatar preview")).toHaveCount(0); expect((await f.db.from("agents").select("id").eq("owner_id", user.id)).data).toEqual([]);
    editor = await choose(page); await editor.getByRole("slider", { name: "Zoom", exact: true }).fill("1.7"); await editor.getByRole("button", { name: "Rotate", exact: true }).click();
    await editor.getByText("Position controls", { exact: true }).click(); await editor.getByRole("slider", { name: "Horizontal position", exact: true }).fill("0.5");
    await editor.getByRole("button", { name: "Use image", exact: true }).click(); await expect(editor).toHaveCount(0); await expect(page.getByAltText("Selected avatar preview")).toBeVisible();
    await page.getByRole("button", { name: "Edit image", exact: true }).click(); await expect(page.getByRole("slider", { name: "Zoom", exact: true })).toHaveValue("1.7"); await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("button", { name: "Create my agent", exact: true })).toBeEnabled(); await page.getByRole("button", { name: "Create my agent", exact: true }).click(); await expect(page).toHaveURL(/\/chats\//);
    const agent = (await f.db.from("agents").select("id,avatar").eq("owner_id", user.id).single()).data!; expect(agent.avatar).toMatch(/^\/api\/avatars\//);
    await expect(page.getByTestId("identity-switcher").locator("img")).toHaveAttribute("src", new RegExp(`${agent.avatar}$`));
    const published = await page.request.get(agent.avatar); expect(published.status()).toBe(200); expect(await sharp(await published.body()).metadata()).toMatchObject({ width: 512, height: 512, format: "webp" });
    await page.goto("/settings/profile"); await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Edit image", exact: true }).click(); await expect(page.getByRole("dialog")).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Reset", exact: true }).click(); await page.getByRole("button", { name: "Use image", exact: true }).click();
    expect((await f.db.from("agents").select("avatar").eq("id", agent.id).single()).data?.avatar).toBe(agent.avatar);
    await page.getByRole("button", { name: "Save", exact: true }).click(); await expect(page).toHaveURL(/saved=1/);
    const saved = (await f.db.from("agents").select("avatar").eq("id", agent.id).single()).data!.avatar; expect(saved).not.toBe(agent.avatar); expect((await page.request.get(agent.avatar)).status()).toBe(404);
    await page.getByRole("button", { name: "Use a preset instead", exact: true }).click(); await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(async () => (await f.db.from("agents").select("avatar").eq("id", agent.id).single()).data?.avatar).not.toMatch(/^\/api\/avatars\//); expect((await page.request.get(saved)).status()).toBe(404);
    await page.goto("/business/new"); await page.getByLabel("Business name").fill(`Managed ${f.tag}`); await page.getByTestId("avatar-choice").locator("summary").click();
    editor = await choose(page); await editor.getByRole("button", { name: "Fit whole logo", exact: true }).click(); await editor.getByRole("button", { name: "Use image", exact: true }).click();
    await expect(page.getByRole("button", { name: "Create business", exact: true })).toBeEnabled(); await page.getByRole("button", { name: "Create business", exact: true }).click(); await expect(page).toHaveURL(/\/chats\//);
    const owned = (await f.db.from("business_managers").select("business_agent_id").eq("user_id", user.id).single()).data!;
    expect((await f.db.from("agents").select("avatar").eq("id", owned.business_agent_id).single()).data?.avatar).toMatch(/^\/api\/avatars\//);

  } finally { await f.cleanup(); }
});

test("business signup supports fitting a logo and publishes it on the public page", async ({ page }) => {
  const f = await onboardingFixture();
  try {
    const user = await f.user(); await login(page, user.email, f.password); await expect(page).toHaveURL(/\/onboarding/); await page.getByRole("radio", { name: /Business/ }).click(); await page.getByLabel("Business name").fill(`Logo ${f.tag}`);
    await page.getByTestId("avatar-choice").locator("summary").click(); const editor = await choose(page); await editor.getByRole("button", { name: "Fit whole logo", exact: true }).click(); await editor.getByRole("button", { name: "Use image", exact: true }).click();
    await expect(page.getByRole("button", { name: "Create my agent", exact: true })).toBeEnabled(); await page.getByRole("button", { name: "Create my agent", exact: true }).click(); await expect(page).toHaveURL(/\/chats\//);
    const agent = (await f.db.from("agents").select("avatar,handle").eq("owner_id", user.id).single()).data!;
    await page.goto(`/u/${agent.handle}`); const image = page.locator(`img[src$="${agent.avatar}"]`).first(); await expect(image).toBeVisible(); await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(512);
  } finally { await f.cleanup(); }
});

test("a Manager can change only the selected business avatar; Staff cannot edit it", async ({ browser }) => {
  const f = await businessStaffFixture(); const context = await browser.newContext();
  try {
    await f.db.from("business_managers").insert([{ business_agent_id: f.business.agent.id, user_id: f.marco.userId, role: "manager" }, { business_agent_id: f.business.agent.id, user_id: f.paul.userId, role: "staff", supervisor_id: f.marco.userId }]);
    const page = await context.newPage(); await login(page, f.marco.email, f.password); await expect(page).toHaveURL(/\/chats/);
    await page.getByTestId("identity-switcher").click(); await page.getByTestId(`identity-${f.business.agent.handle}`).click(); await expect(page.getByTestId("identity-switcher")).toContainText(f.business.agent.handle);
    await page.goto("/settings/profile"); const editor = await choose(page); await editor.getByRole("button", { name: "Use image", exact: true }).click(); await page.getByRole("button", { name: "Save", exact: true }).click(); await expect(page).toHaveURL(/saved=1/);
    expect((await f.db.from("agents").select("avatar").eq("id", f.business.agent.id).single()).data?.avatar).toMatch(/^\/api\/avatars\//);
    expect((await f.db.from("agents").select("avatar").eq("id", f.marco.agent.id).single()).data?.avatar).toBe(f.marco.agent.avatar);
    await context.close(); const staffContext = await browser.newContext();
    try { const staff = await staffContext.newPage(); await login(staff, f.paul.email, f.password); await expect(staff).toHaveURL(/\/chats/); await staff.getByTestId("identity-switcher").click(); await staff.getByTestId(`identity-${f.business.agent.handle}`).click(); await expect(staff.getByTestId("identity-switcher")).toContainText(f.business.agent.handle); await staff.goto("/settings/profile"); await expect(staff.getByRole("button", { name: "Upload photo or logo", exact: true })).toHaveCount(0); await expect(staff.getByText(/An owner or manager manages this business profile/)).toBeVisible(); } finally { await staffContext.close(); }
  } finally { await context.close(); await f.cleanup(); }
});
