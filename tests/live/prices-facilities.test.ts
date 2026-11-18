/**
 * "Prices & facilities": read from a business's own documents when their text changes, merged with
 * the business's corrections and confirmations, used by its agent with a note saying where each fact
 * comes from, and tidied when a document goes. Isolated business (never the demo accounts).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { dbUp } from "./env";
import { planBusinessFixture } from "../fixtures/plan-business";

const auth = vi.hoisted(() => ({ agentId: "" }));
vi.mock("@/lib/auth", () => ({ requireAgent: async () => { const { getAgentById } = await import("@/lib/data/agents"); const agent = await getAgentById(auth.agentId); if (!agent) throw new Error("Not signed in"); return { agent, user: { id: agent.owner_id, businessRole: "owner" } }; } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

describe.skipIf(!dbUp)("prices & facilities (live)", () => {
  let f: Awaited<ReturnType<typeof planBusinessFixture>>;
  let menu: string;
  beforeAll(async () => { f = await planBusinessFixture(); auth.agentId = f.business.agent.id; });
  afterAll(async () => { await f?.cleanup(); });
  const lib = async () => ({ offerings: await import("@/lib/business/offerings"), actions: await import("@/app/(app)/business/actions"), respond: await import("@/lib/agents/respond"), agents: await import("@/lib/data/agents") });
  const prices = async () => (await f.db.from("business_prices").select("*").eq("agent_id", f.business.agent.id).order("item")).data ?? [];
  const facility = async (key: string) => (await f.db.from("business_facilities").select("*").eq("agent_id", f.business.agent.id).eq("key", key).maybeSingle()).data;
  const setMenu = (content: string) => f.db.from("business_sources").update({ content, last_read_at: new Date().toISOString() }).eq("id", menu);

  it("reads a document's prices and facilities, and only reads again when its text changed", async () => {
    const { offerings } = await lib();
    const { data } = await f.db.from("business_sources").insert({ agent_id: f.business.agent.id, url: "https://sole.example/menu.pdf", origin: "link", visibility: "public", status: "ok", kind: "pdf", content: "Menu\nMargherita pizza (12-inch) £8.50\nTiramisù £6\nFree car park behind the restaurant.", last_read_at: new Date().toISOString() }).select("id").single();
    menu = data!.id;
    await offerings.readOfferings(menu);
    expect((await prices()).map((p) => [p.item, p.variant, Number(p.price), p.source_label])).toEqual([["Margherita pizza", "12-inch", 8.5, "menu.pdf"], ["Tiramisù", null, 6, "menu.pdf"]]);
    expect(await facility("parking")).toMatchObject({ status: "yes", evidence: "Free car park behind the restaurant", source_label: "menu.pdf", confirmed: false });
    // Same text: not read again (a change made meanwhile isn't overwritten).
    await f.db.from("business_prices").update({ price: 1 }).eq("agent_id", f.business.agent.id).eq("item", "Tiramisù");
    await offerings.readOfferings(menu);
    expect(Number((await prices()).find((p) => p.item === "Tiramisù")!.price)).toBe(1);
  });

  it("keeps the business's corrections and confirmations when the document changes", async () => {
    const { offerings, actions } = await lib();
    const margherita = (await prices()).find((p) => p.item === "Margherita pizza")!;
    expect(await actions.correctPriceAction(margherita.id, 8)).toEqual({});
    expect(await actions.setFacilityAction("parking", "no")).toEqual({});
    await setMenu("Menu\nMargherita pizza (12-inch) £9\nCalzone £10\nFree car park behind the restaurant.");
    await offerings.readOfferings(menu);
    const after = await prices();
    expect(after.map((p) => p.item)).toEqual(["Calzone", "Margherita pizza"]); // Tiramisù is no longer on the menu
    expect(after.find((p) => p.item === "Margherita pizza")).toMatchObject({ corrected: true, found_price: 9 });
    expect(Number(after.find((p) => p.item === "Margherita pizza")!.price)).toBe(8);
    expect(await facility("parking")).toMatchObject({ status: "no", confirmed: true });
  });

  it("the business's agent answers from them, saying where each fact comes from; customers-only stays for customers", async () => {
    const { respond, agents, offerings, actions } = await lib();
    const agent = (await agents.getAgentById(f.business.agent.id))!;
    const price = await respond.draftBusinessAnswer(agent, "How much is a margherita pizza?", [], "public");
    expect(price.answer).toContain("£8.00 (confirmed by the business)");
    const calzone = await respond.draftBusinessAnswer(agent, "How much is a calzone?", [], "public");
    expect(calzone.answer).toMatch(/£10\.00 \(from menu\.pdf, read today\)/);
    // A customers-only document: its prices are for the business's contacts.
    const { data: staff } = await f.db.from("business_sources").insert({ agent_id: f.business.agent.id, url: "https://sole.example/regulars.pdf", origin: "link", visibility: "public", status: "ok", kind: "pdf", content: "Regulars\nLoyalty lasagne £5", last_read_at: new Date().toISOString() }).select("id").single();
    await offerings.readOfferings(staff!.id);
    expect(await actions.setSourceVisibilityAction(staff!.id, "customers")).toEqual({});
    expect(await offerings.offeringsKnowledgeFor(agent.id, "public")).not.toContain("Loyalty lasagne");
    expect(await offerings.offeringsKnowledgeFor(agent.id, "customers")).toContain("Loyalty lasagne: £5.00");
  });

  it("hide, add and remove prices; removing a document keeps only what the business corrected", async () => {
    const { actions } = await lib();
    const calzone = (await prices()).find((p) => p.item === "Calzone")!;
    expect(await actions.hidePriceAction(calzone.id, true)).toEqual({});
    expect(await (await import("@/lib/business/offerings")).offeringsKnowledgeFor(f.business.agent.id, "public")).not.toContain("Calzone");
    expect(await actions.addPriceAction({ item: "Garlic bread", variant: null, price: 4.5, currency: "gbp" })).toEqual({});
    expect(await actions.addPriceAction({ item: "", variant: null, price: 4.5, currency: "GBP" })).toHaveProperty("error");
    const garlic = (await prices()).find((p) => p.item === "Garlic bread")!;
    expect(garlic).toMatchObject({ added: true, currency: "GBP", source_url: null });
    expect(await actions.removeSourceAction(menu)).toEqual({});
    const left = await prices();
    expect(left.map((p) => p.item).sort()).toEqual(["Garlic bread", "Loyalty lasagne", "Margherita pizza"]);
    expect(left.find((p) => p.item === "Margherita pizza")).toMatchObject({ added: true, source_url: null });
    expect(await facility("parking")).toMatchObject({ confirmed: true }); // what the business confirmed stays
    expect(await actions.removePriceAction(garlic.id)).toEqual({});
    expect((await prices()).some((p) => p.item === "Garlic bread")).toBe(false);
  });
});
