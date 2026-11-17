import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { config } from "dotenv";
import { businessStaffFixture } from "../tests/fixtures/business-staff";
config({ path: ".env.local", quiet: true });

test("personal, owner, manager and standalone business badges stay separate and update live", async ({ browser }) => {
  test.setTimeout(240_000);
  const f = await businessStaffFixture(); const contexts: BrowserContext[] = [];
  const login = async (email: string) => { const context = await browser.newContext(); contexts.push(context); const page = await context.newPage(); await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(f.password); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(/\/chats/); return page; };
  const header = (page: Page) => page.getByTestId("identity-waiting");
  const menu = (page: Page, handle: string) => page.getByTestId(`identity-count-${handle}`);
  const switchTo = async (page: Page, handle: string) => { if (await page.getByTestId("identity-switcher").getAttribute("aria-expanded") !== "true") await page.getByTestId("identity-switcher").click(); await page.getByTestId(`identity-${handle}`).click(); await expect(page.getByTestId("identity-switcher")).toContainText(`@${handle}`); };
  try {
    const home = await f.db.from("conversations").insert({ kind: "my_agent", created_by: f.business.userId }).select("id").single(); expect(home.error).toBeNull();
    expect((await f.db.from("conversation_members").insert({ conversation_id: home.data!.id, user_id: f.business.userId, role: "owner" })).error).toBeNull();
    const requests = await f.db.from("inbox_items").insert(["Can you securely store a cello?", "Do you have a hearing loop?"].map((question) => ({ owner_id: f.business.userId, agent_id: f.business.agent.id, from_agent: f.luca.agent.id, kind: "question", payload: { kind: "question", business: true, question } }))).select("id"); expect(requests.error).toBeNull();
    expect((await f.db.from("messages").insert(Array.from({ length: 50 }, (_, i) => ({ conversation_id: home.data!.id, sender_agent_id: f.business.agent.id, is_ai_generated: true, content: `Request record ${i}`, metadata: { kind: "request_note", inbox_item_id: requests.data![i % 2].id } })))).error).toBeNull();
    expect((await f.db.from("messages").insert({ conversation_id: f.group, sender_user_id: f.luca.userId, content: "Personal notification", is_ai_generated: false })).error).toBeNull();
    const owner = await login(f.business.email); await expect(header(owner)).toHaveText("2"); await expect(owner.getByTestId("chats-badge")).toHaveText("2");
    await owner.getByTestId("identity-switcher").click(); await expect(owner.getByRole("menuitem")).toHaveCount(1); await expect(menu(owner, f.business.agent.handle)).toHaveText("2"); await owner.getByTestId("identity-switcher").click();
    const marco = await login(f.marco.email); await expect(header(marco)).toHaveText("1"); await marco.getByTestId("identity-switcher").click(); await expect(menu(marco, f.marco.agent.handle)).toHaveText("1"); await expect(marco.getByTestId(`identity-${f.business.agent.handle}`)).toHaveCount(0);
    // Membership and inactive-business counts arrive without opening business data.
    expect((await f.db.from("business_managers").insert([{ business_agent_id: f.business.agent.id, user_id: f.marco.userId, role: "manager" }, { business_agent_id: f.business.agent.id, user_id: f.paul.userId, role: "owner" }])).error).toBeNull();
    await expect(menu(marco, f.business.agent.handle)).toHaveText("2"); await expect(header(marco)).toHaveText("1");
    const paul = await login(f.paul.email); await expect(header(paul)).toHaveText("1"); await paul.getByTestId("identity-switcher").click(); await expect(menu(paul, f.business.agent.handle)).toHaveText("2");
    await switchTo(marco, f.business.agent.handle); await expect(header(marco)).toHaveText("2"); await expect(marco.getByTestId("chats-badge")).toHaveText("2");
    await marco.getByTestId("identity-switcher").click(); await expect(menu(marco, f.marco.agent.handle)).toHaveText("1"); await expect(menu(marco, f.business.agent.handle)).toHaveText("2"); await marco.getByTestId("identity-switcher").click();
    await marco.getByTestId("my-agent-card").click(); await expect(marco.getByTestId("inbox-item")).toHaveCount(2);
    await expect(marco.getByRole("button", { name: "Needs you 2", exact: true })).toBeVisible(); await marco.getByRole("button", { name: "Needs you 2", exact: true }).click(); await expect(marco.getByTestId("topic-attention")).toContainText("2 requests");
    await expect(marco.getByTestId("thread-badge")).toHaveCount(0); await expect(header(marco)).toHaveText("2");
    // Another team member handles one request; company views converge while personal stays unchanged.
    expect((await f.db.from("inbox_items").update({ status: "answered" }).eq("id", requests.data![0].id)).error).toBeNull();
    await expect(header(marco)).toHaveText("1"); await expect(marco.getByTestId("inbox-item")).toHaveCount(1); await expect(marco.getByRole("button", { name: "Needs you 1", exact: true })).toBeVisible();
    await expect(menu(paul, f.business.agent.handle)).toHaveText("1"); await expect(header(paul)).toHaveText("1"); await expect(header(owner)).toHaveText("1");
    await switchTo(marco, f.marco.agent.handle); await expect(header(marco)).toHaveText("1");
    // Read on another device: personal clears, inactive company request stays pending.
    const personal = await f.signed(f.marco); const message = await f.db.from("messages").select("id").eq("conversation_id", f.group).eq("content", "Personal notification").single();
    expect((await personal.rpc("acknowledge_messages", { p_ids: [message.data!.id], p_seen: true })).error).toBeNull();
    await expect(header(marco)).toHaveCount(0); await marco.getByTestId("identity-switcher").click(); await expect(menu(marco, f.marco.agent.handle)).toHaveCount(0); await expect(menu(marco, f.business.agent.handle)).toHaveText("1");
    await switchTo(marco, f.business.agent.handle); await expect(header(marco)).toHaveText("1");
    // Review approvals belong to Owners/Managers, never to ordinary Staff.
    const draft = await f.db.from("business_answer_drafts").insert({ business_agent_id: f.business.agent.id, author_id: f.marco.userId, author_name: "Marco", question: "Do you offer secure storage?", answer: "We offer locked indoor storage." }).select("id").single(); expect(draft.error).toBeNull();
    expect((await f.db.from("inbox_items").insert({ owner_id: f.business.userId, agent_id: f.business.agent.id, kind: "business_answer_review", payload: { draft_id: draft.data!.id } })).error).toBeNull();
    await expect(header(marco)).toHaveText("2");
    expect((await f.db.from("business_managers").update({ role: "staff" }).eq("business_agent_id", f.business.agent.id).eq("user_id", f.marco.userId)).error).toBeNull();
    await expect(header(marco)).toHaveText("1"); await expect(marco.getByTestId("chats-badge")).toHaveText("1");
    const response = await marco.request.get("/api/notifications"); expect(response.ok()).toBe(true); expect(await response.json()).toMatchObject({ actorId: f.marco.userId, currentId: f.business.userId });
    const anonymous = await browser.newContext(); contexts.push(anonymous); const denied = await anonymous.request.get("http://localhost:3001/api/notifications", { maxRedirects: 0 }); expect(denied.status()).toBe(307); expect(new URL(denied.headers().location, denied.url()).pathname).toBe("/login");
  } finally { await Promise.allSettled(contexts.map((context) => context.close())); await f.cleanup(); }
});

test("a delayed response from the old identity cannot overwrite the selected workspace", async ({ browser }) => {
  const f = await businessStaffFixture(); const context = await browser.newContext();
  let release: () => void = () => {}; const held = new Promise<void>((resolve) => { release = resolve; });
  try {
    await f.db.from("business_managers").insert({ business_agent_id: f.business.agent.id, user_id: f.marco.userId, role: "manager" });
    await f.db.from("inbox_items").insert({ owner_id: f.business.userId, agent_id: f.business.agent.id, kind: "question", payload: { business: true, question: "Any wheelchair access?" } });
    const page = await context.newPage(); await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(f.marco.email); await page.getByLabel("Password", { exact: true }).fill(f.password); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(/\/chats/);
    let captured: () => void = () => {}; const waiting = new Promise<void>((resolve) => { captured = resolve; }); let first = true;
    await page.route("**/api/notifications", async (route) => { if (!first) { await route.continue(); return; } first = false; const response = await route.fetch(); captured(); await held; await route.fulfill({ response }).catch(() => {}); });
    await page.evaluate(() => window.dispatchEvent(new Event("agentme:read"))); await waiting;
    await page.getByTestId("identity-switcher").click(); await page.getByTestId(`identity-${f.business.agent.handle}`).click(); await expect(page.getByTestId("identity-switcher")).toContainText(f.business.agent.handle); await expect(page.getByTestId("identity-waiting")).toHaveText("1");
    release(); await page.getByTestId("identity-switcher").click(); await expect(page.getByTestId(`identity-count-${f.marco.agent.handle}`)).toHaveCount(0); await expect(page.getByTestId(`identity-count-${f.business.agent.handle}`)).toHaveText("1"); await expect(page.getByTestId("identity-waiting")).toHaveText("1");
  } finally { release(); await context.close(); await f.cleanup(); }
});
