import { expect, test, type BrowserContext } from "@playwright/test";
import { config } from "dotenv";
import { planBusinessFixture } from "../tests/fixtures/plan-business";

config({ path: ".env.local", quiet: true });
async function login(context: BrowserContext, email: string, password: string) {
  const page = await context.newPage(); await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(password); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(/\/chats/); return page;
}

test("group invitations stay in My Agent, joining reveals future messages, and declining stays private", async ({ browser }) => {
  const f = await planBusinessFixture(); const a = await browser.newContext(); const b = await browser.newContext(); const c = await browser.newContext();
  try {
    expect((await f.db.from("contacts").insert([f.marco, f.paul].map((p) => ({ requester_agent: f.luca.agent.id, addressee_agent: p.agent.id, status: "accepted" as const })))).error).toBeNull();
    const luca = await login(a, f.luca.email, f.password); await luca.goto("/groups"); await luca.getByRole("button", { name: /New group/ }).click();
    const form = luca.getByRole("form", { name: "New group", exact: true }); await form.getByLabel("Group name", { exact: false }).fill("A dinner invitation"); await form.getByLabel("Description", { exact: false }).fill("Dinner planning with friends");
    const search = form.getByRole("combobox", { name: "Search contacts", exact: true }); await search.fill("Marco"); await form.getByRole("option", { name: /Marco/ }).click(); await search.fill("Paul"); await form.getByRole("option", { name: /Paul/ }).click();
    await form.getByRole("button", { name: "Create group", exact: true }).click(); await expect(luca).toHaveURL(/\/groups\/[0-9a-f-]+$/);
    const groupId = luca.url().split("/").at(-1)!; await expect(luca.getByTestId("group-member")).toHaveCount(1); await expect(luca.getByTestId("pending-group-invites")).toContainText("Pending invitations · 2");
    const { error } = await f.db.from("messages").insert({ conversation_id: groupId, sender_user_id: f.luca.userId, content: "PRIVATE_BEFORE_ANYONE_JOINS", is_ai_generated: false }); expect(error).toBeNull();
    const marco = await login(b, f.marco.email, f.password); await marco.goto(`/chats/${groupId}`); await expect(marco.getByRole("heading", { name: "404", exact: true })).toBeVisible();
    await marco.goto("/chats"); await marco.getByRole("link", { name: /My Agent/ }).first().click();
    const invite = marco.getByTestId("inbox-item").filter({ hasText: "A dinner invitation" }); await expect(invite).toContainText("Luca"); await expect(invite).toContainText("Dinner planning with friends"); await expect(invite).toContainText("1 member"); await expect(invite).toContainText("Messages from joining");
    await invite.getByRole("button", { name: "Join group", exact: true }).click(); await expect(marco).toHaveURL(new RegExp(`/chats/${groupId}$`));
    await expect(marco.getByText("PRIVATE_BEFORE_ANYONE_JOINS", { exact: true })).toHaveCount(0);
    await f.db.from("messages").insert({ conversation_id: groupId, sender_user_id: f.luca.userId, content: "Welcome Marco, this is visible after joining", is_ai_generated: false });
    await expect(marco.getByText("Welcome Marco, this is visible after joining", { exact: true })).toBeVisible();
    const paul = await login(c, f.paul.email, f.password); await paul.goto("/chats"); await paul.getByRole("link", { name: /My Agent/ }).first().click();
    const decline = paul.getByTestId("inbox-item").filter({ hasText: "A dinner invitation" }); await expect(decline).toContainText("2 members"); await decline.getByRole("button", { name: "Decline", exact: true }).click(); await expect(decline).toHaveCount(0);
    await paul.goto(`/chats/${groupId}`); await expect(paul.getByRole("heading", { name: "404", exact: true })).toBeVisible();
    expect((await f.db.from("messages").select("content").eq("conversation_id", groupId)).data!.some((m) => /declin/i.test(m.content))).toBe(false);
    await luca.reload(); await expect(luca.getByTestId("group-member")).toHaveCount(2); await expect(luca.getByTestId("pending-group-invites")).toHaveCount(0);
  } finally { await a.close(); await b.close(); await c.close(); await f.cleanup(); }
});

test("an administrator can withdraw a pending invitation without exposing the group", async ({ browser }) => {
  const f = await planBusinessFixture(); const a = await browser.newContext(); const b = await browser.newContext();
  try {
    await f.db.from("contacts").insert({ requester_agent: f.luca.agent.id, addressee_agent: f.marco.agent.id, status: "accepted" });
    const luca = await login(a, f.luca.email, f.password); await luca.goto("/groups"); await luca.getByRole("button", { name: /New group/ }).click();
    const form = luca.getByRole("form", { name: "New group", exact: true }); await form.getByLabel("Group name", { exact: false }).fill("Withdraw this invitation"); await form.getByRole("combobox", { name: "Search contacts", exact: true }).fill("Marco"); await form.getByRole("option", { name: /Marco/ }).click(); await form.getByRole("button", { name: "Create group", exact: true }).click(); await expect(luca).toHaveURL(/\/groups\/[0-9a-f-]+$/); const groupId = luca.url().split("/").at(-1)!;
    await luca.getByTestId("pending-group-invites").locator("summary").click(); await luca.getByRole("button", { name: "Withdraw invitation", exact: true }).click(); await expect(luca.getByTestId("pending-group-invites")).toHaveCount(0);
    const marco = await login(b, f.marco.email, f.password); await marco.goto("/chats"); await marco.getByRole("link", { name: /My Agent/ }).first().click(); await expect(marco.getByTestId("inbox-item").filter({ hasText: "Withdraw this invitation" })).toHaveCount(0);
    await marco.goto(`/chats/${groupId}`); await expect(marco.getByRole("heading", { name: "404", exact: true })).toBeVisible();
  } finally { await a.close(); await b.close(); await f.cleanup(); }
});

test("private-community links can require moderator approval after explicit rules acceptance", async ({ browser }) => {
  const f = await planBusinessFixture(); const a = await browser.newContext(); const b = await browser.newContext(); let communityId: string | null = null;
  try {
    const luca = await login(a, f.luca.email, f.password); await luca.goto("/communities"); await luca.getByRole("button", { name: /New community/ }).click();
    const form = luca.getByRole("form", { name: "New community", exact: true }); const name = `Private ${crypto.randomUUID().slice(0, 8)}`;
    await form.getByLabel("Name", { exact: false }).fill(name); await form.getByLabel("What is it about?", { exact: false }).fill("A private community for testing consent and approval."); await form.getByRole("radio", { name: /^Private/ }).check(); await form.getByRole("checkbox", { name: /Approve people joining private communities/ }).check(); await form.getByRole("button", { name: "Create community", exact: true }).click();
    await expect(luca).toHaveURL(/\/communities\/[0-9a-f-]+$/); communityId = luca.url().split("/").at(-1)!;
    expect((await f.db.from("communities").select("approve_link_members").eq("id", communityId).single()).data!.approve_link_members).toBe(true);
    const token = crypto.randomUUID().replaceAll("-", ""); expect((await f.db.from("join_links").insert({ token, community_id: communityId, created_by: f.luca.userId, expires_at: new Date(Date.now() + 3600000).toISOString() })).error).toBeNull();
    const marco = await login(b, f.marco.email, f.password); await marco.goto(`/invite/${token}`); await expect(marco.getByRole("button", { name: "Request to join", exact: true })).toBeDisabled(); await marco.getByLabel("I accept the rules", { exact: true }).check(); await marco.getByRole("button", { name: "Request to join", exact: true }).click();
    await expect(marco.getByRole("status")).toContainText("Request sent. Waiting for approval."); await expect(marco).toHaveURL(new RegExp(`/invite/${token}$`));
    expect((await f.db.from("community_members").select("user_id").eq("community_id", communityId).eq("user_id", f.marco.userId)).data).toEqual([]);
    await luca.reload(); await luca.getByTestId("fold-moderation").locator("summary").first().click(); const request = luca.getByTestId("join-request").filter({ hasText: "Marco" }); await request.getByRole("button", { name: "Let in", exact: true }).click(); await expect(request).toHaveCount(0);
    await marco.goto(`/communities/${communityId}`); await expect(marco.getByRole("heading", { name, exact: true })).toBeVisible();
  } finally { await a.close(); await b.close(); if (communityId) await f.db.from("communities").delete().eq("id", communityId); await f.cleanup(); }
});
