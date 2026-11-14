import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { config } from "dotenv";
import { planBusinessFixture } from "../tests/fixtures/plan-business";

config({ path: ".env.local", quiet: true });
test("recall stays private; a business receives one explicitly approved staff question", async ({ browser }) => {
  const f = await planBusinessFixture();
  const sessions: BrowserContext[] = [];
  async function login(browser: Browser, email: string) {
    const context = await browser.newContext();
    sessions.push(context);
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(f.password);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(/\/chats/);
    return page;
  }
  async function send(page: Page, text: string) {
    await page.getByLabel("Message", { exact: true }).fill(text);
    await page.getByRole("button", { name: "Send", exact: true }).click();
  }
  try {
    const luca = await login(browser, f.luca.email);
    for (const name of ["Trattoria", `@${f.business.agent.handle}`]) {
      await luca.goto(`/chats/${f.myAgent}?t=new`);
      await send(luca, `What time did we agree for dinner at ${name} on 21 November, and who is coming?`);
      const messages = luca.getByRole("list", { name: "Messages", exact: true });
      await expect(messages).toContainText("Trattoria Sole");
      await expect(messages).toContainText("21 November 2026 at 7:00 PM");
      await expect(messages).toContainText("You, Marco and Paul are all in.");
      await expect(messages).toContainText("AGENTME hasn't made a reservation");
      await expect(messages).toContainText("To arrange one, use the options below.");
      await expect(messages.getByTestId("rich-text").filter({ hasText: "Your dinner at Trattoria Sole" })).not.toContainText("020 7946 0000");
      await expect(luca.getByRole("link", { name: /Call 020 7946 0000/ })).toHaveAttribute("href", "tel:02079460000");
      await expect(luca.getByRole("link", { name: /Email bookings@sole.example/ })).toHaveAttribute("href", "mailto:bookings@sole.example");
      await expect(luca.getByRole("link", { name: /Book online/ })).toHaveAttribute("href", "https://sole.example/book");
      await expect(luca.getByRole("button", { name: /Ask @|Ask the team/ })).toHaveCount(0);
    }
    expect((await f.db.from("task_exchanges").select("id").eq("to_agent", f.business.agent.id)).data).toEqual([]);
    expect((await f.db.from("inbox_items").select("id").eq("agent_id", f.business.agent.id)).data).toEqual([]);
    await luca.goto(`/chats/${f.direct}`);
    await send(luca, "Can you securely store four bicycles indoors?");
    await expect(luca.getByRole("button", { name: "Ask the team", exact: true })).toBeVisible();
    expect((await f.db.from("inbox_items").select("id").eq("agent_id", f.business.agent.id)).data).toEqual([]);
    await luca.getByRole("button", { name: "Ask the team", exact: true }).click();
    await expect(luca.getByRole("status").filter({ hasText: "Sent to the team" })).toBeVisible();
    const shop = await login(browser, f.business.email);
    await shop.getByTestId("my-agent-card").click();
    const item = shop.getByTestId("inbox-item").filter({ hasText: "four bicycles" });
    await expect(item).toHaveCount(1);
    const publish = item.getByRole("checkbox", { name: /Publish this as a public FAQ/ });
    await expect(publish).not.toBeChecked();
    await item.getByLabel(/Your answer/).fill("We can securely store four bicycles indoors during your meal.");
    await publish.check();
    await item.getByRole("button", { name: "Send answer", exact: true }).click();
    await expect(item).toHaveCount(0);
    await expect(luca.getByRole("list", { name: "Messages", exact: true })).toContainText("The team at Trattoria Sole: We can securely store four bicycles");
    await send(luca, "Can you securely store four bicycles indoors?");
    await expect(luca.getByRole("button", { name: "Ask the team", exact: true })).toHaveCount(0);
    await expect(luca.getByRole("list", { name: "Messages", exact: true }).getByRole("listitem").last()).toContainText("We can securely store four bicycles");
  } finally {
    for (const context of sessions) await context.close();
    await f.cleanup();
  }
});
