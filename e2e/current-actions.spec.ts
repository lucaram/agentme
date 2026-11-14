import { expect, test, type BrowserContext } from "@playwright/test";
import { config } from "dotenv";
import { planBusinessFixture } from "../tests/fixtures/plan-business";
import { waysOf } from "../lib/business/booking";

config({ path: ".env.local", quiet: true });

test("saved customer actions update open plans and historical My Agent replies without rewriting text", async ({ browser }) => {
  const f = await planBusinessFixture();
  const sessions: BrowserContext[] = [];
  async function login(email: string) {
    const context = await browser.newContext(); sessions.push(context);
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(f.password);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(/\/chats/);
    return page;
  }
  try {
    f.business.agent.business_info = { ...f.business.agent.business_info as object, ways: [{ kind: "book", value: `https://${f.business.agent.handle}.example/book` }, { kind: "email", value: `bookings@${f.business.agent.handle}.example` }, { kind: "call", value: "020 7946 0000" }] };
    await f.db.from("agents").update({ business_info: f.business.agent.business_info }).eq("id", f.business.agent.id);
    const { data: proposal } = await f.db.from("proposals").select("id").eq("task_id", f.taskId).single();
    const { error } = await f.db.from("messages").insert({ conversation_id: f.group, sender_agent_id: f.luca.agent.id, is_ai_generated: true, content: "Original shared plan", metadata: { kind: "proposal", proposal_id: proposal!.id, task_id: f.taskId } });
    if (error) throw error;
    const owner = await login(f.luca.email);
    await owner.goto(`/chats/${f.myAgent}?t=new`);
    await owner.getByLabel("Message", { exact: true }).fill("What time did we agree for dinner at Trattoria on 21 November, and who is coming?");
    await owner.getByRole("button", { name: "Send", exact: true }).click();
    const messages = owner.getByRole("list", { name: "Messages", exact: true });
    const recall = messages.getByRole("listitem").filter({ hasText: "Your dinner at Trattoria Sole" });
    await expect(recall.getByRole("link", { name: "📞 Call", exact: true })).toHaveAttribute("href", "tel:02079460000");
    const { data: historical } = await f.db.from("messages").select("id,content,metadata,thread_id").eq("conversation_id", f.myAgent).eq("sender_agent_id", f.luca.agent.id).eq("metadata->>booking_business_id", f.business.agent.id).single();
    const { data: legacy, error: legacyError } = await f.db.from("messages").insert({ conversation_id: f.myAgent, thread_id: historical!.thread_id, sender_agent_id: f.luca.agent.id, is_ai_generated: true, content: "Legacy answer remains unchanged.", metadata: { booking_ways: waysOf(f.business.agent.business_info) } }).select("id").single();
    if (legacyError) throw legacyError;
    const legacyCard = messages.getByRole("listitem").filter({ hasText: "Legacy answer remains unchanged." });
    await expect(legacyCard.getByRole("link", { name: "📞 Call", exact: true })).toBeVisible();
    await expect.poll(async () => (await f.db.from("messages").select("metadata").eq("id", legacy!.id).single()).data?.metadata).toMatchObject({ booking_business_id: f.business.agent.id });

    const marco = await login(f.marco.email); await marco.goto(`/chats/${f.group}`);
    const plan = marco.getByTestId("proposal");
    await expect(plan.getByRole("link", { name: "📞 Call", exact: true })).toBeVisible();
    const business = await login(f.business.email); await business.goto("/business#book-or-order");
    const actions = business.getByRole("form", { name: "How customers book or order", exact: true });
    const save = async () => {
      await actions.getByRole("button", { name: "Save customer actions", exact: true }).click();
      await expect(actions.getByRole("status")).toContainText("Saved.");
    };
    await actions.getByRole("button", { name: "Remove way 3", exact: true }).click();
    await save();
    for (const card of [recall, legacyCard, plan]) await expect(card.getByRole("link", { name: "📞 Call", exact: true })).toHaveCount(0);

    // All three views must keep updating even after every original destination changes.
    await actions.getByLabel("Way 1: link or number", { exact: true }).fill("https://sole.example/new-booking");
    await actions.getByLabel("Way 2: link or number", { exact: true }).fill("new@sole.example");
    await actions.getByRole("button", { name: /Add another way/ }).click();
    await actions.getByLabel("Way 3: what is it", { exact: true }).selectOption("call");
    await actions.getByLabel("Way 3: link or number", { exact: true }).fill("020 7777 7777");
    await save();
    for (const card of [recall, legacyCard, plan]) {
      await expect(card.getByRole("link", { name: "📞 Call", exact: true })).toHaveAttribute("href", "tel:02077777777");
      await expect(card.getByRole("link", { name: "📅 Book", exact: true })).toHaveAttribute("href", "https://sole.example/new-booking");
      await expect(card.getByRole("link", { name: "✉️ Email", exact: true })).toHaveAttribute("href", "mailto:new@sole.example");
    }
    await actions.getByLabel("Way 3: link or number", { exact: true }).fill("020 8888 8888");
    await save();
    await expect(plan.getByRole("link", { name: "📞 Call", exact: true })).toHaveAttribute("href", "tel:02088888888");

    // An explicitly empty list must not revive the old phone number from the FAQ.
    while (await actions.getByTestId("way-row").count()) await actions.getByTestId("way-row").last().getByRole("button", { name: /^Remove way/ }).click();
    await save();
    for (const card of [recall, legacyCard, plan]) await expect(card.getByTestId("business-ways")).toHaveCount(0);
    await owner.reload(); await marco.reload();
    await expect(recall.getByTestId("business-ways")).toHaveCount(0);
    await expect(plan.getByTestId("business-ways")).toHaveCount(0);
    const { data: saved } = await f.db.from("messages").select("content,metadata").eq("id", historical!.id).single();
    expect(saved).toEqual({ content: historical!.content, metadata: historical!.metadata });
    expect((await f.db.from("messages").select("content").eq("id", legacy!.id).single()).data?.content).toBe("Legacy answer remains unchanged.");
  } finally {
    for (const session of sessions) await session.close();
    await f.cleanup();
  }
});
