import { expect, test } from "@playwright/test";
import { config } from "dotenv";
import { ClientFactory } from "@a2a-js/sdk/client";
import { signAgentToken } from "../lib/a2a/auth";
import { buildMessage, dataPart, extractResult, textPart } from "../lib/a2a/messages";
import { planBusinessFixture } from "../tests/fixtures/plan-business";
config({ path: ".env.local", quiet: true });

test("tip visibility uses the profile controls and is enforced over real agent-to-agent requests", async ({ browser }) => {
  const f = await planBusinessFixture(); const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  try {
    await context.addCookies([{ name: "agentme_look", value: "dark.purple.standard.black.plain", url: "http://localhost:3001" }]);
    expect((await f.db.from("contacts").insert({ requester_agent: f.luca.agent.id, addressee_agent: f.marco.agent.id, status: "accepted" })).error).toBeNull();
    const page = await context.newPage(); await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(f.luca.email); await page.getByLabel("Password", { exact: true }).fill(f.password); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(/\/chats/);
    await page.goto("/settings"); await expect(page.getByRole("link", { name: /^Saved tips/ })).toHaveCount(0); await page.getByTestId("about-you-link").click();
    const category = page.getByTestId("topic-saved-tips"); await expect(category).not.toHaveAttribute("open");
    expect(await category.evaluate((el) => el.previousElementSibling?.getAttribute("data-testid"))).toBe("topic-lifestyle");
    await category.locator("summary").click(); const add = category.getByRole("form", { name: "Add saved tip", exact: true });
    await expect(add.getByRole("radio", { name: /Only my agent/ })).toBeChecked(); await add.getByLabel("Tip topic", { exact: true }).fill("Plumber"); await add.getByLabel("Tip", { exact: true }).fill("Trusted Plumbing Co."); await add.getByRole("button", { name: "Add tip", exact: true }).click();
    const saved = category.getByTestId("saved-tips").getByRole("listitem"); await expect(saved).toHaveCount(1); await expect(saved).toContainText("Only my agent");
    const query = await f.db.from("agent_tips").select("id,disclosure").eq("agent_id", f.luca.agent.id).single(); expect(query.data!.disclosure).toBe("private");
    await expect(page.getByTestId("profile-preview")).not.toContainText("Trusted Plumbing Co.");
    const client = await new ClientFactory().createFromUrl(`http://localhost:3001/api/a2a/${f.luca.agent.handle}/`);
    const ask = async () => {
      const token = await signAgentToken({ sub: f.marco.agent.id, recipient: f.luca.agent.handle }, process.env.A2A_SIGNING_SECRET!);
      const result = await client.sendMessage({ tenant: "", message: buildMessage({ role: "user", parts: [textPart("Can anyone recommend a plumber?"), dataPart({ type: "agentme.ask_around", question: "Can anyone recommend a plumber?" })] }), configuration: undefined, metadata: undefined }, { serviceParameters: { Authorization: `Bearer ${token}` } });
      return extractResult(result);
    };
    expect(JSON.stringify(await ask())).not.toContain("Trusted Plumbing Co.");
    await saved.getByRole("button", { name: "Edit", exact: true }).click(); let edit = saved.getByRole("form", { name: "Edit saved tip", exact: true }); await expect(edit.getByRole("radio", { name: /Only my agent/ })).toBeChecked(); await edit.getByText("My contacts' agents", { exact: true }).click(); await edit.getByRole("button", { name: "Cancel", exact: true }).click();
    expect((await f.db.from("agent_tips").select("disclosure").eq("id", query.data!.id).single()).data!.disclosure).toBe("private");
    await saved.getByRole("button", { name: "Edit", exact: true }).click(); edit = saved.getByRole("form", { name: "Edit saved tip", exact: true }); await edit.getByText("My contacts' agents", { exact: true }).click(); await edit.getByRole("button", { name: "Save tip", exact: true }).click(); await expect(saved).toContainText("My contacts' agents");
    await expect(edit).toHaveCount(0);
    expect((await ask()).text).toBe("Trusted Plumbing Co.");
    await page.getByTestId("profile-preview").locator("summary").click();
    await expect(page.getByTestId("profile-preview").getByRole("list", { name: "My contacts' agents" })).toContainText("Saved tips (matching recommendations only)");
    await saved.getByRole("button", { name: "Edit", exact: true }).click(); await edit.getByText("Only my agent", { exact: true }).click(); await edit.getByRole("button", { name: "Save tip", exact: true }).click(); await expect(saved).toContainText("Only my agent");
    await expect(edit).toHaveCount(0);
    expect(JSON.stringify(await ask())).not.toContain("Trusted Plumbing Co.");
    await expect(page.getByTestId("profile-preview").getByRole("list", { name: "My contacts' agents" })).toHaveCount(0);
    await page.reload(); await expect(saved).toBeHidden(); await category.locator("summary").click(); await saved.getByRole("button", { name: "Edit", exact: true }).click(); await expect(edit.getByRole("radio", { name: /Only my agent/ })).toBeChecked();
    await category.scrollIntoViewIfNeeded(); await page.screenshot({ path: "test-results/saved-tip-visibility-desktop.png" }); await page.setViewportSize({ width: 390, height: 844 }); await edit.getByRole("radio", { name: /Only my agent/ }).scrollIntoViewIfNeeded(); await page.screenshot({ path: "test-results/saved-tip-visibility-mobile.png" }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await Promise.allSettled([context.close()]); await f.cleanup(); }
});
