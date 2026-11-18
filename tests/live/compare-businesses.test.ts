/**
 * Comparing businesses from My Agent: the same points to every business, the answers on one card,
 * "not stated" with "Ask the team", the team's answer filling the cell, and reuse within a day.
 * Throwaway owner and businesses, deleted afterwards. The A2A transport is replaced with each
 * business's fixed answers (the business side is tested elsewhere); everything else is real.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { admin, dbUp } from "./env";
import type { Comparison } from "@/lib/compare/comparison";

type AgentRow = NonNullable<Awaited<ReturnType<typeof import("@/lib/data/agents").getAgentById>>>;
const run = Math.random().toString(36).slice(2, 7);
const sent = vi.hoisted(() => ({ calls: [] as { from: string; to: string; text: string; data?: unknown }[] }));

// Each business's agent answers from what it published; Luigi's doesn't know and offers its team.
vi.mock("@/lib/a2a/client", () => ({
  sendAgentMessage: vi.fn(async (opts: { fromAgentId: string; toHandle: string; text: string; data?: unknown }) => {
    sent.calls.push({ from: opts.fromAgentId, to: opts.toHandle, text: opts.text, data: opts.data });
    const price = /margherita/i.test(opts.text), taskId = crypto.randomUUID();
    if (opts.toHandle.startsWith("sole")) return { ok: true, text: price ? "A margherita is £8.50 (12-inch).\n\n📄 From sole.example/menu.pdf · checked today" : "Yes, a free car park behind the restaurant.", data: null, state: "completed", taskId };
    if (opts.toHandle.startsWith("napoli")) return { ok: true, text: price ? "Our margherita costs £9 (10-inch)." : "No parking, street parking only.", data: null, state: "completed", taskId };
    return { ok: true, text: "I don't have that information yet. Would you like to ask the team? Nothing has been sent to them.", data: { type: "agentme.business.handoff_offer", question: opts.text, faq_eligible: true }, state: "completed", taskId };
  }),
}));

describe.skipIf(!dbUp)("comparing businesses (live)", () => {
  const users: string[] = [];
  let owner: AgentRow;
  let conv: string;
  const businesses: AgentRow[] = [];
  const make = async (handle: string, type: "personal" | "business", name: string) => {
    const { data: created, error } = await admin().auth.admin.createUser({ email: `${handle}@compare.test`, password: "compare-password", email_confirm: true });
    if (error) throw error;
    users.push(created.user.id);
    const { data, error: agentError } = await admin().from("agents").insert({ owner_id: created.user.id, handle, display_name: name, type, contact_policy: "anyone" }).select("*").single();
    if (agentError) throw agentError;
    return data as AgentRow;
  };
  const lib = async () => ({ run: await import("@/lib/compare/run"), team: await import("@/lib/business/ask-team"), handoff: await import("@/lib/business/handoff"), chat: await import("@/lib/data/chat"), cmp: await import("@/lib/compare/comparison") });
  const card = async () => (await admin().from("messages").select("id, content, metadata").eq("conversation_id", conv).eq("metadata->>kind", "business_comparison").order("created_at", { ascending: false }).limit(1).single()).data!;
  const lastText = async () => (await admin().from("messages").select("content").eq("conversation_id", conv).order("created_at", { ascending: false }).limit(1).single()).data!.content;

  beforeAll(async () => {
    owner = await make(`cmp${run}`, "personal", "Owner");
    for (const [h, n] of [["sole", "Trattoria Sole"], ["napoli", "Pizza Napoli"], ["luigi", "Luigi's"]]) businesses.push(await make(`${h}${run}`, "business", n));
    conv = (await (await lib()).chat.getOrCreateMyAgentConversation(owner.owner_id)).id;
  });
  afterAll(async () => {
    await admin().from("conversations").delete().in("created_by", users);
    for (const id of users) await admin().auth.admin.deleteUser(id);
  });

  it("asks every business the same points, and nothing else; fills one card; never ranks 'not stated'", async () => {
    const { run: compare, cmp } = await lib();
    sent.calls = [];
    await compare.compareBusinesses({ agent: owner, conversationId: conv, businesses, text: `Which of @sole${run} @napoli${run} @luigi${run} has the cheapest margherita pizza, and who has parking?` });
    // The same two questions to each of the three; only the question (no profile, no other data).
    expect(sent.calls).toHaveLength(6);
    for (const b of businesses) expect(sent.calls.filter((c) => c.to === b.handle).map((c) => c.text).sort()).toEqual(["Do you have parking?", "How much is a margherita pizza?"]);
    expect(sent.calls.every((c) => c.from === owner.id && c.data === undefined)).toBe(true);
    const { content, metadata } = await card();
    expect(content).toBe("🔍 I asked Trattoria Sole, Pizza Napoli, Luigi's the same questions: Margherita pizza: price · Parking.");
    const c = metadata as unknown as Comparison;
    const at = (b: AgentRow, point: number) => c.cells.find((x) => x.business_id === b.id && x.point === point)!;
    expect(at(businesses[0], 0)).toMatchObject({ status: "answered", number: 8.5, currency: "GBP", detail: "12-inch", source: "menu.pdf" });
    expect(at(businesses[1], 0)).toMatchObject({ status: "answered", number: 9, detail: "10-inch" });
    expect(at(businesses[0], 1)).toMatchObject({ status: "answered", yes: true });
    expect(at(businesses[1], 1)).toMatchObject({ status: "answered", yes: false });
    expect(at(businesses[2], 0)).toMatchObject({ status: "not_stated", handoff: true });
    expect(cmp.summarise(c)).toEqual(["Cheapest stated margherita pizza: Trattoria Sole (£8.50). Sizes may differ.", "Parking: only Trattoria Sole says yes."]);
  });

  it("'Ask the team' sends that one point to the business's team, and their answer fills in the cell", async () => {
    const { run: compare, team, handoff } = await lib();
    const { id, metadata } = await card();
    const luigi = businesses[2];
    const cell = (metadata as unknown as Comparison).cells.find((x) => x.business_id === luigi.id && x.point === 0)!;
    // What the business's side recorded for that question (as the real A2A server does).
    const { data: exchange } = await admin().from("task_exchanges").insert({ from_agent: owner.id, to_agent: luigi.id, skill: "business.faq", status: "completed", a2a_task_id: cell.a2a_task, request: { text: "How much is a margherita pizza?" }, response: { text: "I don't have that information yet.", data: { type: "agentme.business.handoff_offer", question: "How much is a margherita pizza?", faq_eligible: true } } }).select("id").single();
    // Only the owner, only that cell.
    expect(await team.askTeamForComparison(businesses[0].owner_id, owner, id, luigi.id, 0)).toHaveProperty("error");
    expect(await team.askTeamForComparison(owner.owner_id, owner, id, businesses[0].id, 0)).toHaveProperty("error");
    expect(await team.askTeamForComparison(owner.owner_id, owner, id, luigi.id, 0)).toEqual({ notice: "Sent to the team. Their answer will appear on the card." });
    expect((await card()).metadata).toMatchObject({ cells: expect.arrayContaining([expect.objectContaining({ business_id: luigi.id, point: 0, status: "team_asked" })]) });
    const { data: item } = await admin().from("inbox_items").select("id, exchange_id, agent_id").eq("exchange_id", exchange!.id).single();
    expect(item).toBeTruthy();
    // The team answers: the cell is filled in, and a short note says so.
    await handoff.relayTeamAnswer(item!, "Our margherita is £7.");
    const after = (await card()).metadata as unknown as Comparison;
    expect(after.cells.find((x) => x.business_id === luigi.id && x.point === 0)).toMatchObject({ status: "team_answered", number: 7, currency: "GBP", source: "its team" });
    expect(await lastText()).toBe("👤 The team at Luigi's answered “Margherita pizza: price”: Our margherita is £7.");
    const lines = (await lib()).cmp.summarise(after);
    expect(lines[0]).toBe("Cheapest stated margherita pizza: Luigi's (£7). Sizes may differ.");
    void compare;
  });

  it("reuses a business's answer to the same question from the last day", async () => {
    const { run: compare } = await lib();
    const [sole, napoli] = businesses;
    await admin().from("task_exchanges").insert({ from_agent: owner.id, to_agent: sole.id, skill: "business.faq", status: "completed", a2a_task_id: crypto.randomUUID(), request: { text: "Do you have parking?" }, response: { text: "Yes, a free car park behind the restaurant." } });
    sent.calls = [];
    await compare.compareBusinesses({ agent: owner, conversationId: conv, businesses: [sole, napoli], text: `Does @sole${run} or @napoli${run} have parking?` });
    expect(sent.calls.map((c) => c.to)).toEqual([napoli.handle]);
    const c = (await card()).metadata as unknown as Comparison;
    expect(c.cells.find((x) => x.business_id === sole.id)).toMatchObject({ status: "answered", yes: true, reused: true });
  });

  it("asks what to compare when it isn't clear, and stops at five businesses; nothing is sent", async () => {
    const { run: compare } = await lib();
    sent.calls = [];
    await compare.compareBusinesses({ agent: owner, conversationId: conv, businesses: businesses.slice(0, 2), text: `Which of @sole${run} and @napoli${run} is best?` });
    expect(await lastText()).toBe("What should I compare? For example the price of a dish, parking, or opening hours. Nothing has been sent.");
    const six = Array.from({ length: 6 }, (_, i) => ({ ...businesses[0], id: crypto.randomUUID(), handle: `x${i}` }));
    await compare.compareBusinesses({ agent: owner, conversationId: conv, businesses: six, text: "cheapest margherita pizza?" });
    expect(await lastText()).toBe("I can compare up to 5 businesses at a time. Which 5 should I ask? Nothing has been sent.");
    expect(sent.calls).toHaveLength(0);
  });

  it("in My Agent, a question to two or more businesses becomes a comparison (one business: asked as before)", async () => {
    const { handleOwnerMessage } = await import("@/lib/coordination/orchestrator");
    sent.calls = [];
    await handleOwnerMessage({ userId: owner.owner_id, agent: owner, conversationId: conv, text: `@sole${run} @napoli${run} which has the cheapest margherita pizza?` });
    const c = (await card()).metadata as unknown as Comparison;
    expect(c.businesses.map((b) => b.name)).toEqual(["Trattoria Sole", "Pizza Napoli"]);
    expect(c.points.map((p) => p.label)).toEqual(["Margherita pizza: price"]);
    expect(sent.calls.map((x) => x.text)).toEqual(["How much is a margherita pizza?", "How much is a margherita pizza?"]);
  });
});
