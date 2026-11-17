import { expect, test, type BrowserContext } from "@playwright/test";
import { config } from "dotenv";
import { planBusinessFixture } from "../tests/fixtures/plan-business";
config({ path: ".env.local", quiet: true });

test("separate arrivals aggregate across chats and stay in a persistent inbox until visibly read", async ({ browser }) => {
  const f = await planBusinessFixture(); const context = await browser.newContext();
  try {
    await context.addCookies([{ name: "agentme_look", value: "dark.purple.standard.black.plain", url: "http://localhost:3001" }]);
    await f.db.from("conversations").update({ title: "Dinner" }).eq("id", f.group);
    const second = await f.db.from("conversations").insert({ kind: "group", title: "Weekend", created_by: f.luca.userId }).select("id").single(); expect(second.error).toBeNull();
    expect((await f.db.from("conversation_members").insert([f.luca, f.marco].map((p) => ({ conversation_id: second.data!.id, user_id: p.userId, role: p === f.luca ? "owner" : "member", history_from: "-infinity" })))).error).toBeNull();
    const page = await login(context, f.marco.email, f.password); await page.goto("/settings");
    const button = page.getByTestId("mentions-button"); await expect(button).toHaveAttribute("aria-label", "Mentions, 0 unread");
    await button.click(); const panel = page.getByRole("dialog", { name: "Unread mentions", exact: true }); await expect(panel).toContainText("No unread mentions."); await panel.getByRole("button", { name: "Close mentions", exact: true }).click();
    const send = async (conversation = f.group) => { const result = await f.db.from("messages").insert({ conversation_id: conversation, sender_user_id: f.luca.userId, content: `@${f.marco.agent.handle} shall we meet?`, is_ai_generated: false }).select("id").single(); if (result.error) throw result.error; return result.data!.id; };
    const first = await send(); const banner = page.getByTestId("mention-notification"); await expect(banner).toContainText("Luca mentioned you in Dinner.");
    await send(); await expect(banner).toContainText("2 new mentions in Dinner");
    const weekend = await send(second.data!.id); await expect(banner).toContainText("3 new mentions in 2 chats"); await expect(button).toHaveAttribute("aria-label", "Mentions, 3 unread");
    await banner.getByRole("button", { name: "View", exact: true }).click(); await expect(panel.getByTestId("unread-mention")).toHaveCount(3); await expect(panel.getByRole("region", { name: "Dinner", exact: true })).toBeVisible(); await expect(panel.getByRole("region", { name: "Weekend", exact: true })).toBeVisible();
    expect((await f.db.from("mention_alerts").select("seen_at").eq("user_id", f.marco.userId)).data!.every((a) => a.seen_at === null)).toBe(true);
    expect(await panel.evaluate((el) => Math.abs(el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2 - innerWidth / 2))).toBeLessThan(2);
    await page.screenshot({ path: "test-results/desktop-mention-inbox.png" }); await page.setViewportSize({ width: 390, height: 780 }); await expect(panel).toBeInViewport({ ratio: 1 }); await page.screenshot({ path: "test-results/mobile-mention-inbox.png" });
    await panel.getByRole("button", { name: "Close mentions", exact: true }).click(); await page.setViewportSize({ width: 1280, height: 720 });
    const last = await send(); await expect(banner).toContainText("Luca mentioned you in Dinner."); await banner.getByRole("button", { name: "Dismiss mention notification", exact: true }).click(); await expect(banner).toHaveCount(0); await expect(button).toHaveAttribute("aria-label", "Mentions, 4 unread");
    await button.click(); await expect(panel.getByTestId("unread-mention")).toHaveCount(4); await panel.locator(`a[href="/chats/${f.group}#m-${last}"]`).click(); await expect(page).toHaveURL(new RegExp(`#m-${last}$`));
    await expect.poll(async () => (await f.db.from("mention_alerts").select("seen_at").eq("message_id", first).single()).data?.seen_at).toBeTruthy();
    await expect(button).toHaveAttribute("aria-label", "Mentions, 1 unread");
    const mention = page.locator(`#m-${last}`).getByTestId("person-mention"); await expect(mention).toHaveCSS("font-weight", "600"); await expect(mention).toHaveCSS("color", "rgb(176, 150, 247)");
    await page.reload(); await expect(mention).toHaveCSS("color", "rgb(176, 150, 247)"); await expect(mention).toHaveCSS("font-weight", "600");
    expect((await f.db.from("mention_alerts").select("seen_at").eq("message_id", weekend).single()).data!.seen_at).toBeNull();
    await button.click(); await expect(panel.getByTestId("unread-mention")).toHaveCount(1); await panel.getByRole("button", { name: "Close mentions", exact: true }).click();
    const outgoing = await f.db.from("messages").insert({ conversation_id: f.group, sender_user_id: f.marco.userId, content: `@${f.luca.agent.handle} thanks!`, is_ai_generated: false }).select("id").single(); expect(outgoing.error).toBeNull();
    const bubble = page.locator(`#m-${outgoing.data!.id} [data-outgoing-human="true"]`); await expect(bubble).toBeVisible();
    const textColor = await bubble.evaluate((el) => getComputedStyle(el).color); await expect(bubble.getByTestId("person-mention")).toHaveCSS("color", textColor);
  } finally { await Promise.allSettled([context.close()]); await f.cleanup(); }
});

test("banner lasts ten seconds, resets for new arrivals and pauses for mouse and keyboard interaction", async ({ browser }) => {
  const f = await planBusinessFixture(); const context = await browser.newContext();
  try {
    const page = await login(context, f.marco.email, f.password, true); await page.goto("/settings");
    const send = async () => { const result = await f.db.from("messages").insert({ conversation_id: f.group, sender_user_id: f.luca.userId, content: `@${f.marco.agent.handle} timer test`, is_ai_generated: false }); expect(result.error).toBeNull(); };
    await send(); const banner = page.getByTestId("mention-notification"); await expect(banner).toBeVisible();
    await page.clock.pauseAt(new Date(Date.now() + 1000)); await page.clock.fastForward(6000); await expect(banner).toBeVisible();
    await send(); await expect(banner).toContainText("2 new mentions"); await page.clock.fastForward(7000); await expect(banner).toBeVisible();
    await banner.hover(); await page.clock.fastForward(12000); await expect(banner).toBeVisible();
    await banner.getByRole("button", { name: "View", exact: true }).focus(); await page.mouse.move(1, 1); await page.clock.fastForward(12000); await expect(banner).toBeVisible();
    await page.getByTestId("mentions-button").focus(); await page.clock.fastForward(4000); await expect(banner).toHaveCount(0);
    await expect(page.getByTestId("mentions-button")).toHaveAttribute("aria-label", "Mentions, 2 unread");
  } finally { await Promise.allSettled([context.close()]); await f.cleanup(); }
});
async function login(context: BrowserContext, email: string, password: string, clock = false) {
  const page = await context.newPage(); if (clock) await page.clock.install(); await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(password); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(/\/chats/); return page;
}
test("mention picker notifies a person, opens the exact message and clears the badge only when viewed", async ({ browser }) => {
  const f = await planBusinessFixture(); const a = await browser.newContext(); const b = await browser.newContext();
  try {
    await f.db.from("conversations").update({ title: "Saturday Dinner" }).eq("id", f.group);
    await f.db.from("contacts").insert({ requester_agent: f.luca.agent.id, addressee_agent: f.marco.agent.id, status: "accepted" });
    const marco = await login(b, f.marco.email, f.password); await marco.goto("/settings");
    const luca = await login(a, f.luca.email, f.password); await luca.goto(`/chats/${f.group}`);
    const input = luca.getByRole("textbox", { name: "Message", exact: true }); await input.fill("Hello @mar");
    const suggestions = luca.getByRole("listbox", { name: "Mention suggestions", exact: true }); await expect(suggestions.getByRole("option", { name: "Mention Marco", exact: true })).toBeVisible(); await expect(suggestions.getByRole("option", { name: "Ask Marco’s agent", exact: true })).toBeVisible();
    await suggestions.getByRole("option", { name: "Mention Marco", exact: true }).click(); await expect(input).toHaveValue(`Hello @${f.marco.agent.handle} `); await input.fill(`Hello @${f.marco.agent.handle}, are you coming?`); await luca.getByRole("button", { name: "Send", exact: true }).click();
    const banner = marco.getByTestId("mention-notification"); await expect(banner).toContainText("Luca mentioned you in Saturday Dinner."); await marco.screenshot({ path: "test-results/desktop-mention-banner.png" }); await banner.getByRole("link", { name: "View", exact: true }).click(); await expect(marco).toHaveURL(new RegExp(`/chats/${f.group}#m-[0-9a-f-]+$`));
    const id = marco.url().split("#m-")[1]; await expect(marco.locator(`#m-${id}`).getByTestId("person-mention")).toHaveText(`@${f.marco.agent.handle}`);
    await expect.poll(async () => (await f.db.from("mention_alerts").select("seen_at").eq("message_id", id).eq("user_id", f.marco.userId).single()).data?.seen_at).toBeTruthy();
    await marco.locator(`#m-${id}`).getByTestId("person-mention").click(); const profile = marco.getByRole("dialog", { name: "Mentioned person", exact: true }); await expect(profile).toContainText("Marco"); await profile.getByRole("button", { name: "Close profile", exact: true }).click();
    await marco.goto("/chats"); await expect(marco.getByTestId("mention-badge")).toHaveCount(0);
    expect((await f.db.from("task_exchanges").select("id").eq("from_agent", f.luca.agent.id)).data).toEqual([]);
  } finally { await Promise.allSettled([a.close(), b.close()]); await f.cleanup(); }
});
test("muted chats keep the @ badge and privacy preferences control banners", async ({ browser }) => {
  const f = await planBusinessFixture(); const context = await browser.newContext({ viewport: { width: 390, height: 780 } });
  try {
    await f.db.from("conversation_members").update({ muted: true }).eq("conversation_id", f.group).eq("user_id", f.marco.userId);
    const page = await login(context, f.marco.email, f.password); await page.goto("/chats");
    const saved = await f.db.from("messages").insert({ conversation_id: f.group, sender_user_id: f.luca.userId, content: `@${f.marco.agent.handle} a muted mention`, is_ai_generated: false }).select("id").single(); expect(saved.error).toBeNull();
    const badge = page.getByTestId("mention-badge"); await expect(badge).toBeVisible(); await expect(page.getByTestId("mention-notification")).toHaveCount(0); await badge.click(); await expect(page).toHaveURL(new RegExp(`#m-${saved.data!.id}$`)); await expect(page.locator(`#m-${saved.data!.id}`)).toBeInViewport();
    await page.goto("/settings/privacy"); const toggle = page.getByRole("checkbox", { name: /Notify me when someone mentions me/ }); await expect(toggle).toBeChecked(); await toggle.uncheck(); await page.getByRole("button", { name: "Save", exact: true }).click(); await expect(toggle).not.toBeChecked();
    await f.db.from("conversation_members").update({ muted: false }).eq("conversation_id", f.group).eq("user_id", f.marco.userId);
    const disabled = await f.db.from("messages").insert({ conversation_id: f.group, sender_user_id: f.luca.userId, content: `@${f.marco.agent.handle} no banner please`, is_ai_generated: false }).select("id").single();
    await expect.poll(async () => (await f.db.from("mention_alerts").select("notified_at").eq("message_id", disabled.data!.id).eq("user_id", f.marco.userId).single()).data?.notified_at).toBeTruthy(); await expect(page.getByTestId("mention-notification")).toHaveCount(0);
    await toggle.check(); await page.getByRole("button", { name: "Save", exact: true }).click(); await expect(toggle).toBeChecked();
    await f.db.from("messages").insert({ conversation_id: f.group, sender_user_id: f.luca.userId, content: `@${f.marco.agent.handle} mobile notification`, is_ai_generated: false });
    const banner = page.getByTestId("mention-notification"); await expect(banner).toBeInViewport({ ratio: 1 });
    expect(await banner.evaluate((el) => el.getBoundingClientRect().top >= (document.querySelector("header")?.getBoundingClientRect().bottom ?? 0))).toBe(true);
    await page.screenshot({ path: "test-results/mobile-mention-banner.png" }); await expect(banner).toHaveCount(0, { timeout: 15000 });
  } finally { await Promise.allSettled([context.close()]); await f.cleanup(); }
});
test("asking a personal agent stays private and produces an approval card in both entry points", async ({ browser }) => {
  const f = await planBusinessFixture(); const context = await browser.newContext();
  try {
    await f.db.from("contacts").insert({ requester_agent: f.luca.agent.id, addressee_agent: f.marco.agent.id, status: "accepted" });
    const page = await login(context, f.luca.email, f.password); await page.goto(`/chats/${f.group}`); const input = page.getByRole("textbox", { name: "Message", exact: true });
    await input.fill("@mar"); await page.getByRole("option", { name: "Ask Marco’s agent", exact: true }).click(); await expect(input).toHaveValue(`@agent ask @${f.marco.agent.handle}’s agent `);
    await input.fill(`@agent ask @${f.marco.agent.handle}’s agent whether he’s available for dinner on Saturday`); await page.getByRole("button", { name: "Send", exact: true }).click(); await expect(page.getByText(`Ask @${f.marco.agent.handle}’s agent:`, { exact: false })).toBeVisible(); await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
    expect((await f.db.from("mention_alerts").select("message_id").eq("conversation_id", f.group)).data).toEqual([]);
    expect((await f.db.from("task_exchanges").select("id").eq("from_agent", f.luca.agent.id)).data).toEqual([]);
    await page.goto(`/chats/${f.myAgent}`); await page.getByRole("textbox", { name: "Message", exact: true }).fill(`Ask @${f.marco.agent.handle} whether he’s available for dinner on Saturday`); await page.getByRole("button", { name: "Send", exact: true }).click(); await expect(page.getByText(`Ask @${f.marco.agent.handle}’s agent:`, { exact: false })).toBeVisible(); await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
  } finally { await Promise.allSettled([context.close()]); await f.cleanup(); }
});
