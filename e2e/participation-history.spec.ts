import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { config } from "dotenv";
import { planBusinessFixture } from "../tests/fixtures/plan-business";

config({ path: ".env.local", quiet: true });

async function expectActivity(page: Page, text: string) {
  const note = page.getByTestId("system-note").filter({ hasText: text }); const down = page.getByTestId("jump-to-latest");
  // While reading a card, new activity waits below instead of interrupting it.
  await expect.poll(async () => await note.count() > 0 || await down.isVisible()).toBe(true);
  if (!await note.count()) await down.click();
  await expect(note.locator("time")).toBeVisible();
}

test("names and local action times stay current in shared cards and My Agent", async ({ browser }) => {
  const f = await planBusinessFixture();
  const sessions: BrowserContext[] = [];
  async function login(email: string, timezoneId: string) {
    const context = await browser.newContext({ timezoneId }); sessions.push(context);
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(f.password);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(/\/chats/);
    return page;
  }
  try {
    const { data: extraSteps, error } = await f.db.from("plan_steps").insert([
      { task_id: f.taskId, position: 1, type: "poll", status: "waiting", config: { question: "Pizza or sushi?", options: ["Pizza", "Sushi"], voters: [f.luca.agent.handle, f.marco.agent.handle, f.paul.agent.handle] } },
      { task_id: f.taskId, position: 2, type: "assign", status: "waiting", config: { title: "Bring along", items: ["Drinks", "Bread"], people: [f.luca.agent.handle, f.marco.agent.handle, f.paul.agent.handle] } },
    ]).select("id,type");
    if (error) throw error;
    const pollId = extraSteps!.find((s) => s.type === "poll")!.id;
    const assignId = extraSteps!.find((s) => s.type === "assign")!.id;
    const { data: proposal } = await f.db.from("proposals").select("id").eq("task_id", f.taskId).single();
    const { data: cards, error: postError } = await f.db.from("messages").insert([
      { conversation_id: f.group, content: "Suggested plan", metadata: { kind: "proposal", proposal_id: proposal!.id, task_id: f.taskId } },
      { conversation_id: f.group, content: "Dinner poll", metadata: { kind: "poll", step_id: pollId, task_id: f.taskId } },
      { conversation_id: f.group, content: "Bring along", metadata: { kind: "assign", step_id: assignId, task_id: f.taskId } },
      { conversation_id: f.myAgent, content: "Your request", metadata: { kind: "task_card", task_id: f.taskId } },
      { conversation_id: f.myAgent, content: "Suggested plan", metadata: { kind: "proposal", proposal_id: proposal!.id, task_id: f.taskId } },
    ].map((m) => ({ ...m, sender_agent_id: f.luca.agent.id, is_ai_generated: true }))).select("thread_id,conversation_id");
    if (postError) throw postError;
    const threadId = cards!.find((m) => m.conversation_id === f.myAgent)!.thread_id;
    const owner = await login(f.luca.email, "America/New_York");
    await owner.goto(`/chats/${f.myAgent}?t=${threadId}`);
    const marco = await login(f.marco.email, "Europe/London");
    await marco.goto(`/chats/${f.group}`);

    // Each saved RSVP has a name and timestamp; a changed answer updates in My Agent too.
    const ownerRsvp = owner.getByTestId("rsvps").getByTestId("action-stamp").filter({ hasText: "Marco" });
    await expect(ownerRsvp.locator("time")).toBeVisible();
    await marco.getByTestId("proposal").getByRole("radio", { name: "Can't make it", exact: true }).click();
    await expect(ownerRsvp).toContainText("can't make it");
    const { data: rsvp } = await f.db.from("step_responses").select("updated_at").eq("step_id", f.stepId).eq("agent_id", f.marco.agent.id).single();
    await expect(ownerRsvp.locator("time")).toHaveAttribute("datetime", rsvp!.updated_at);

    const sharedPoll = marco.getByTestId("poll");
    const ownerPoll = owner.getByTestId("poll");
    await sharedPoll.getByRole("button", { name: "Pizza", exact: true }).click();
    await expect(ownerPoll.getByRole("list", { name: "Votes for Pizza", exact: true })).toContainText("Marco");
    await sharedPoll.getByRole("button", { name: "Sushi", exact: true }).click();
    await expect(ownerPoll.getByTestId("poll-count-Pizza")).toHaveText("0 votes");
    const currentVote = ownerPoll.getByRole("list", { name: "Votes for Sushi", exact: true });
    await expect(currentVote.getByTestId("action-stamp")).toHaveCount(1);
    await expect(currentVote).toContainText("Marco");
    const { data: vote } = await f.db.from("step_responses").select("updated_at").eq("step_id", pollId).eq("agent_id", f.marco.agent.id).single();
    await expect(currentVote.locator("time")).toHaveAttribute("datetime", vote!.updated_at);
    const localTime = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" }).format(new Date(vote!.updated_at));
    await expect(currentVote.locator("time")).toHaveText(localTime);
    await expectActivity(owner, "Marco voted for Pizza.");
    await expectActivity(owner, "Marco changed their vote to Sushi.");

    await marco.getByTestId("item-Drinks").getByRole("button", { name: "I'll take it", exact: true }).click();
    await expect(owner.getByTestId("item-Drinks")).toContainText("Marco");
    await expect(owner.getByTestId("item-Drinks").locator("time")).toBeVisible();
    await marco.getByTestId("item-Drinks").getByRole("button", { name: "Give back", exact: true }).click();
    await expect(owner.getByTestId("item-Drinks").locator("time")).toHaveCount(0);
    await expectActivity(owner, "Marco can't bring/do Drinks anymore");

    await ownerPoll.getByRole("button", { name: "Close poll now", exact: true }).click();
    await expect(sharedPoll).toContainText("Poll closed");
    await expectActivity(marco, "Luca closed the poll.");

    // A changed plan clears stale RSVP timestamps while preserving the dated activity.
    await owner.getByTestId("proposal").getByRole("button", { name: "Change plan", exact: true }).click();
    await owner.getByTestId("proposal").getByLabel("Time", { exact: true }).fill("20:00");
    await owner.getByTestId("proposal").getByRole("button", { name: "Save change", exact: true }).click();
    await expect(ownerRsvp).toContainText("waiting");
    await expect(ownerRsvp.locator("time")).toHaveCount(0);
    await expectActivity(marco, "Luca changed the plan:");
    await owner.reload();
    await expect(ownerPoll.getByRole("list", { name: "Votes for Sushi", exact: true })).toContainText("Marco");

    // Responsive layout keeps attribution usable on narrow chat cards.
    await marco.setViewportSize({ width: 390, height: 844 });
    await expect(sharedPoll.getByRole("list", { name: "Votes for Sushi", exact: true }).locator("time")).toBeVisible();
    const fits = await marco.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(fits).toBe(true);
    await marco.screenshot({ path: "test-results/participation-mobile.png", fullPage: true });
  } finally {
    for (const session of sessions) await session.close();
    await f.cleanup();
  }
});
