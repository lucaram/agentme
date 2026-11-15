import { expect, test, type BrowserContext } from "@playwright/test";
import { config } from "dotenv";
import { planBusinessFixture } from "../tests/fixtures/plan-business";

config({ path: ".env.local", quiet: true });

test("sections start collapsed across the app; updates stay unread until opened", async ({ browser }) => {
  test.setTimeout(180_000);
  const f = await planBusinessFixture();
  const sessions: BrowserContext[] = [];
  let communityId: string | undefined;
  const login = async (email: string) => {
    const context = await browser.newContext(); sessions.push(context);
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(f.password);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(/\/chats/);
    return page;
  };
  try {
    const { data: community, error } = await f.db.from("communities").insert({ name: `Sections ${crypto.randomUUID().slice(0, 8)}`, owner_id: f.luca.userId }).select("id").single();
    if (error) throw error;
    communityId = community!.id;
    const setup = await Promise.all([
      f.db.from("community_members").insert({ community_id: communityId, user_id: f.luca.userId, role: "owner" }),
      f.db.from("join_requests").insert({ community_id: communityId, user_id: f.paul.userId }),
      f.db.from("contacts").insert({ requester_agent: f.luca.agent.id, addressee_agent: f.marco.agent.id, status: "accepted" }),
      f.db.from("notices").insert([
        { user_id: f.luca.userId, area: "groups", text: "A group update awaits your review", needs_action: true },
        { user_id: f.luca.userId, area: "communities", text: "A community update awaits your review", needs_action: true },
      ]),
    ]);
    for (const result of setup) if (result.error) throw result.error;

    const page = await login(f.luca.email);
    for (const path of ["/chats", `/chats/${f.myAgent}`, "/contacts", "/discover", "/groups", `/groups/${f.group}`, "/communities", `/communities/${communityId}`, "/settings", "/settings/profile", "/settings/about", "/settings/privacy", "/settings/personalise", "/settings/tips", "/history"]) {
      await test.step(path, async () => {
        const response = await page.goto(path);
        expect(response?.ok()).toBe(true);
        await expect(page.locator("details[open]")).toHaveCount(0);
      });
    }
    // Visiting a tab with collapsed updates must leave its unseen badges intact.
    expect((await f.db.from("notices").select("seen_at").eq("user_id", f.luca.userId)).data).toEqual([{ seen_at: null }, { seen_at: null }]);

    await page.goto("/contacts");
    const contacts = page.getByTestId("fold-contacts");
    await contacts.locator("summary").first().click();
    await expect(contacts).toHaveAttribute("open", "");
    await expect(contacts.getByText("Marco", { exact: true })).toBeVisible();
    await page.getByRole("navigation").first().getByRole("link", { name: /^Groups/ }).click();
    await expect(page).toHaveURL(/\/groups$/);
    await expect(page.getByRole("heading", { name: "Groups", exact: true })).toBeVisible();
    await page.getByRole("navigation").first().getByRole("link", { name: /^Contacts/ }).click();
    await expect(page).toHaveURL(/\/contacts$/);
    await expect(contacts).not.toHaveAttribute("open");

    // Explicit search results still open in response to the search request.
    await page.goto(`/discover?q=${f.marco.agent.handle}`);
    await expect(page.getByTestId("fold-search")).toHaveAttribute("open", "");
    await expect(page.getByTestId("fold-find-known")).not.toHaveAttribute("open");
    await page.goto("/groups");
    await page.getByTestId("notices").locator("summary").first().click();
    await expect.poll(async () => (await f.db.from("notices").select("seen_at").eq("user_id", f.luca.userId).eq("area", "groups").single()).data?.seen_at).toBeTruthy();
    expect((await f.db.from("notices").select("seen_at").eq("user_id", f.luca.userId).eq("area", "communities").single()).data?.seen_at).toBeNull();

    const nonmember = await login(f.marco.email);
    await nonmember.goto("/communities");
    await expect(nonmember.locator("details[open]")).toHaveCount(0);
    await nonmember.goto(`/communities/${communityId}`);
    await expect(nonmember.locator("details[open]")).toHaveCount(0);
    await nonmember.getByText("Rules", { exact: true }).click();
    await expect(nonmember.getByTestId("community-rules")).toBeVisible();

    const shop = await login(f.business.email);
    await shop.goto("/business");
    await expect(shop.getByTestId("fold-documents")).toBeVisible();
    await expect(shop.locator("details[open]")).toHaveCount(0);
    // SSR markup can be visible before client effects register hashchange handlers.
    // Confirm interactivity before exercising same-document fragment navigation.
    await shop.getByRole("button", { name: "Test your agent", exact: true }).click();
    await expect(shop.getByRole("dialog", { name: "Test your agent", exact: true })).toBeVisible();
    await shop.getByRole("button", { name: "Close agent preview", exact: true }).click();
    await shop.goto("/business#website-documents");
    await expect(shop.getByTestId("fold-documents")).toHaveAttribute("open", "");
    await expect(shop.locator("details[open]")).toHaveCount(1);
  } finally {
    for (const session of sessions) await session.close();
    if (communityId) await f.db.from("communities").delete().eq("id", communityId);
    await f.cleanup();
  }
});
