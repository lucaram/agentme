import { expect, test } from "@playwright/test";

test("Personalise: theme, accent and text size apply at once, and follow you to another device", async ({ browser }) => {
  const id = `${Date.now()}`.slice(-8);
  const email = `look${id}@agentme.test`;
  const context = await browser.newContext({ colorScheme: "light" });
  const page = await context.newPage();
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("a-good-password");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Your name").fill("Lena");
  await page.getByLabel("Agent address").fill(`lena${id}`);
  await expect(page.getByText(`@lena${id} is available.`)).toBeVisible();
  await page.getByRole("button", { name: "Create my agent" }).click();
  await expect(page.getByText(`I'm @lena${id}, your agent`)).toBeVisible();

  await page.goto("/settings");
  await expect(page.getByTestId("personalise-link")).toContainText("System · Green · Standard text");
  await page.getByTestId("personalise-link").click();
  const html = page.locator("html");
  await page.getByRole("radio", { name: "Dark", exact: true }).click();
  await page.getByRole("radio", { name: "Purple", exact: true }).click();
  await page.getByRole("radio", { name: "Large", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(html).toHaveAttribute("data-accent", "purple");
  // The dark purple shade is in use, and text is bigger.
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim())).toBe("#b096f7");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("18px");
  // Dark style only shows when the app can be dark.
  await expect(page.getByRole("radio", { name: "Black", exact: true })).toBeVisible();

  // Drawn in the chosen look straight away after a reload.
  await page.reload();
  await expect(html).toHaveAttribute("data-accent", "purple");
  await page.goto("/settings");
  await expect(page.getByTestId("personalise-link")).toContainText("Dark · Purple · Large text");

  // Another device: log in and the look comes along.
  const other = await browser.newContext({ colorScheme: "light" });
  const second = await other.newPage();
  await second.goto("/login");
  await second.getByLabel("Email").fill(email);
  await second.getByLabel("Password").fill("a-good-password");
  await second.getByRole("button", { name: "Log in" }).click();
  await expect(second).toHaveURL(/\/chats/);
  await expect(second.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(second.locator("html")).toHaveAttribute("data-accent", "purple");
  await context.close();
  await other.close();
});
