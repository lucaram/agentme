import { expect, test, type Page } from "@playwright/test";
import { config } from "dotenv";
import { onboardingFixture } from "../tests/fixtures/onboarding";
config({ path: ".env.local", quiet: true });

async function logIn(page: Page, email: string, password: string) {
  await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(password); await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding/);
}
async function create(page: Page, button = "Create my agent") {
  await expect(page.getByRole("button", { name: button, exact: true })).toBeEnabled();
  await page.getByRole("button", { name: button, exact: true }).click();
  await expect(page).toHaveURL(/\/chats\//);
}

test("minimal personal signup preserves an invitation destination and dismissal persists", async ({ page }) => {
  const f = await onboardingFixture();
  try {
    const user = await f.user(); await logIn(page, user.email, f.password);
    await page.goto("/onboarding?next=%2Fcontacts%3Ffrom%3Dinvite");
    await expect(page.getByTestId("optional-details")).not.toHaveAttribute("open");
    await expect(page.getByTestId("avatar-choice")).not.toHaveAttribute("open");
    await page.getByLabel("Your name").fill(`Simple ${f.tag}`);
    await expect(page.getByRole("button", { name: "Create my agent", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Create my agent", exact: true }).click();
    await expect(page).toHaveURL(/\/contacts\?from=invite$/);
    const invitation = page.getByTestId("setup-invitation"); await expect(invitation).toContainText("Personalise your agent");
    const agent = await f.db.from("agents").select("id").eq("owner_id", user.id).single();
    expect((await f.db.from("agent_facts").select("id").eq("agent_id", agent.data!.id)).data).toEqual([]);
    await invitation.getByRole("button", { name: "Not now", exact: true }).click(); await expect(invitation).toHaveCount(0);
    await page.reload(); await expect(invitation).toHaveCount(0);
    expect((await f.db.from("onboarding_state").select("dismissed_at").eq("user_id", user.id).single()).data?.dismissed_at).toBeTruthy();
  } finally { await f.cleanup(); }
});

test("optional personal details arrive in Settings with explicit sharing and remain editable", async ({ page }) => {
  const f = await onboardingFixture();
  try {
    const user = await f.user(); await logIn(page, user.email, f.password); await page.getByLabel("Your name").fill(`Person ${f.tag}`);
    const optional = page.getByTestId("optional-details"); await optional.locator("summary").first().click();
    const availability = optional.getByRole("group", { name: /When you're free/ });
    const food = optional.getByRole("group", { name: /Food & drink/ });
    await expect(availability.getByRole("radio", { name: /Only my agent/ })).toBeChecked();
    await expect(food.getByRole("radio", { name: /Only my agent/ })).toBeChecked();
    await availability.getByRole("textbox").fill("Saturday evenings");
    await food.getByRole("textbox").fill("Italian and vegetarian"); await food.getByText("My contacts' agents", { exact: true }).click();
    await optional.getByRole("textbox", { name: "Private notes", exact: true }).fill("Private surgery note");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: "test-results/onboarding-personal-mobile.png", fullPage: true });
    await create(page);
    const agent = await f.db.from("agents").select("id").eq("owner_id", user.id).single();
    const facts = await f.db.from("agent_facts").select("category,value,disclosure").eq("agent_id", agent.data!.id);
    expect(facts.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "availability", value: "Saturday evenings", disclosure: "private" }),
      expect.objectContaining({ category: "food", value: "Italian and vegetarian", disclosure: "contacts" }),
      expect.objectContaining({ category: "notes", value: "Private surgery note", disclosure: "private" }),
    ]));
    await page.getByTestId("setup-invitation").getByRole("button", { name: "Add details", exact: true }).click(); await expect(page).toHaveURL(/\/settings\/about$/);
    await expect(page.getByTestId("topic-availability")).toContainText("Saturday evenings");
    await page.getByTestId("topic-lifestyle").click(); await expect(page).toHaveURL(/\/settings\/about\/lifestyle$/);
    const savedFood = page.getByTestId("topic-food"); await savedFood.locator("summary").click();
    await expect(savedFood.getByRole("radio", { name: /My contacts' agents/ })).toBeChecked();
    const hobbies = page.getByTestId("topic-interests"); await hobbies.locator("summary").click(); await expect(hobbies.getByRole("radio", { name: /Only my agent/ })).toBeChecked();
    await page.goto("/chats"); await expect(page.getByTestId("setup-invitation")).toHaveCount(0);
  } finally { await f.cleanup(); }
});

test("business website signup finishes before review; findings stay unpublished and the website is reused", async ({ page, baseURL }) => {
  const f = await onboardingFixture();
  try {
    const user = await f.user(); await logIn(page, user.email, f.password); await page.getByRole("radio", { name: /Business/ }).click();
    const optional = page.getByTestId("optional-details"); await expect(optional).not.toHaveAttribute("open"); await optional.locator("summary").first().click();
    await page.getByLabel(/Have a website/).fill(`${baseURL}/demo/site/index.html`); await page.getByRole("button", { name: "Fill in from it", exact: true }).click();
    await expect(page.getByLabel("Business name")).toHaveValue("Caffè Aurora");
    await page.getByLabel("Agent address").fill(`cafe_${f.tag}`);
    await page.getByLabel("About your business", { exact: true }).fill("Independent cafe in Camden.");
    await optional.getByText("More business details", { exact: false }).click();
    await page.getByLabel("Opening hours", { exact: true }).fill("Tue–Sun 9–17");
    await expect(page.getByRole("textbox", { name: /FAQ/ })).toHaveCount(0);
    await page.getByRole("button", { name: "+ Add a question & answer", exact: true }).click();
    await page.getByRole("textbox", { name: "FAQ 1 question", exact: true }).fill("Do you allow dogs?");
    await expect(page.getByTestId("faq-half")).toBeVisible();
    await page.getByRole("textbox", { name: "FAQ 1 answer", exact: true }).fill("Well-behaved dogs are welcome.");
    await create(page);
    const agent = await f.db.from("agents").select("id,business_info").eq("owner_id", user.id).single();
    expect(agent.data?.business_info).toMatchObject({ about: "Independent cafe in Camden.", hours: "Tue–Sun 9–17", website: `${baseURL}/demo/site/index.html`, faqs: [{ q: "Do you allow dogs?", a: "Well-behaved dogs are welcome." }] });
    expect((await f.db.from("business_sites").select("live_at").eq("agent_id", agent.data!.id).single()).data?.live_at).toBeNull();
    await expect(page.getByTestId("setup-invitation")).toContainText("Your website is saved");
    await page.getByRole("button", { name: "Later in My Business", exact: true }).click(); await page.reload(); await expect(page.getByTestId("setup-invitation")).toHaveCount(0);
    await page.goto("/business#website-documents"); await expect(page.getByTestId("fold-documents")).toBeVisible();
    await expect(page.getByTestId("website-card")).toContainText("localhost");
    await page.getByTestId("website-card").getByRole("link", { name: /Review/ }).click();
    await expect(page).toHaveURL(/\/business\/setup$/); await expect(page.getByRole("link", { name: "Later in My Business", exact: true })).toBeVisible();
    await expect(page.getByTestId("learned")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("link", { name: "Later in My Business", exact: true }).click(); await expect(page).toHaveURL(/\/business$/);
  } finally { await f.cleanup(); }
});

test("adding a managed business uses the same optional fields and keeps the personal identity separate", async ({ page }) => {
  const f = await onboardingFixture();
  try {
    const user = await f.user(); await logIn(page, user.email, f.password); await page.getByLabel("Your name").fill(`Owner ${f.tag}`); await create(page);
    await page.goto("/business"); const form = page.getByRole("form", { name: "Add a business", exact: true });
    await expect(form.getByTestId("optional-details")).not.toHaveAttribute("open");
    await form.getByLabel("Business name").fill(`Studio ${f.tag}`); await form.getByTestId("optional-details").locator("summary").first().click();
    await form.getByLabel("About your business", { exact: true }).fill("Local pottery studio."); await form.getByText("More business details", { exact: false }).click();
    await form.getByLabel("Opening hours", { exact: true }).fill("Mon–Fri 10–18");
    await form.getByRole("button", { name: "+ Add a question & answer", exact: true }).click();
    await form.getByRole("textbox", { name: "FAQ 1 question", exact: true }).fill("Unfinished question"); await form.getByRole("button", { name: "Remove question 1", exact: true }).click();
    await form.getByRole("button", { name: "+ Add a question & answer", exact: true }).click();
    await form.getByRole("textbox", { name: "FAQ 1 question", exact: true }).fill("Do you run classes?"); await form.getByRole("textbox", { name: "FAQ 1 answer", exact: true }).fill("Yes, on Fridays.");
    await create(page, "Create business");
    const managed = await f.db.from("business_managers").select("business_agent_id").eq("user_id", user.id).single(); expect(managed.data).toBeTruthy();
    const business = await f.db.from("agents").select("owner_id,business_info").eq("id", managed.data!.business_agent_id).single();
    expect(business.data?.owner_id).not.toBe(user.id); expect(business.data?.business_info).toMatchObject({ about: "Local pottery studio.", hours: "Mon–Fri 10–18", faqs: [{ q: "Do you run classes?", a: "Yes, on Fridays." }] });
    await expect(page.getByTestId("setup-invitation")).toContainText("Introduce your business");
    await page.getByRole("link", { name: "My Business", exact: true }).click(); await page.getByTestId("fold-knows").locator("summary").first().click(); await page.getByTestId("fold-faqs-tab").click(); await expect(page.getByTestId("faq-list")).toContainText("Yes, on Fridays.");
    const personal = await f.db.from("agents").select("type,business_info").eq("owner_id", user.id).single(); expect(personal.data).toMatchObject({ type: "personal", business_info: {} });
  } finally { await f.cleanup(); }
});
