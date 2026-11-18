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
  type Row = Awaited<ReturnType<typeof prices>>[number];
  /** The editing panel's input for an item, from its saved rows. */
  const asInput = (rows: Row[], change: Record<string, unknown> = {}) => ({
    group_id: rows[0].group_id, kind: rows[0].kind as "product" | "service", category: rows[0].category, item: rows[0].item, description: rows[0].description, tags: rows[0].tags,
    price_type: rows[0].price_type as "fixed", currency: rows[0].currency, duration_minutes: rows[0].duration_minutes, needs_booking: rows[0].needs_booking,
    options: rows.map((x) => ({ id: x.id, label: x.variant, price: x.price === null ? null : Number(x.price) })), ...change,
  });
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
    expect(await actions.saveItemAction(asInput([margherita], { options: [{ id: margherita.id, label: "12-inch", price: 8 }] }))).toEqual({ group_id: margherita.group_id });
    expect(await actions.saveFacilityAction({ key: "parking", label: null, status: "no", note: null })).toEqual({ key: "parking" });
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

  it("hide, add and delete items; removing a document keeps only what the business changed", async () => {
    const { actions } = await lib();
    const calzone = (await prices()).find((p) => p.item === "Calzone")!;
    expect(await actions.deleteItemAction(calzone.group_id)).toHaveProperty("error"); // read from a document: hidden instead
    expect(await actions.hideItemAction(calzone.group_id, true)).toEqual({});
    expect(await (await import("@/lib/business/offerings")).offeringsKnowledgeFor(f.business.agent.id, "public")).not.toContain("Calzone");
    const blank = { group_id: null, kind: "product" as const, category: "Sides", item: "Garlic bread", description: null, tags: [], price_type: "fixed" as const, currency: "gbp", duration_minutes: null, needs_booking: false, options: [{ id: null, label: null, price: 4.5 }] };
    expect(await actions.saveItemAction(blank)).toHaveProperty("group_id");
    expect(await actions.saveItemAction({ ...blank, item: "" })).toHaveProperty("error");
    expect(await actions.saveItemAction({ ...blank, item: "Bread", options: [{ id: null, label: null, price: null }] })).toEqual({ error: "Give each option a price, e.g. 8.50." });
    const garlic = (await prices()).find((p) => p.item === "Garlic bread")!;
    expect(garlic).toMatchObject({ added: true, currency: "GBP", source_url: null });
    expect(await actions.removeSourceAction(menu)).toEqual({});
    const left = await prices();
    expect(left.map((p) => p.item).sort()).toEqual(["Garlic bread", "Loyalty lasagne", "Margherita pizza"]);
    expect(left.find((p) => p.item === "Margherita pizza")).toMatchObject({ added: true, source_url: null });
    expect(await facility("parking")).toMatchObject({ confirmed: true }); // what the business confirmed stays
    expect(await actions.deleteItemAction(garlic.group_id)).toEqual({});
    expect((await prices()).some((p) => p.item === "Garlic bread")).toBe(false);
  });

  it("facilities: add your own, edit, and remove; a removed one isn't brought back by the next read", async () => {
    const { actions, offerings } = await lib();
    const added = await actions.saveFacilityAction({ key: null, label: "Live music", status: "yes", note: "Fridays from 8pm" });
    expect(added.key).toMatch(/^custom-[a-z0-9]{8}$/);
    expect(await facility(added.key!)).toMatchObject({ label: "Live music", status: "yes", evidence: "Fridays from 8pm", confirmed: true });
    // Same name again: the same facility (edited), never a second one.
    expect((await actions.saveFacilityAction({ key: null, label: "live music", status: "no", note: null })).key).toBe(added.key);
    expect(await facility(added.key!)).toMatchObject({ status: "no", evidence: null });
    // Your own named like a common one: that common one.
    expect((await actions.saveFacilityAction({ key: null, label: "Wi-Fi", status: "yes", note: null })).key).toBe("wifi");
    expect(await actions.saveFacilityAction({ key: null, label: "", status: "yes", note: null })).toHaveProperty("error");
    expect(await actions.removeFacilityAction(added.key!)).toEqual({});
    expect(await facility(added.key!)).toBeNull();
    // A common one read from a document, removed: set aside, and a later read doesn't bring it back.
    const { data: doc } = await f.db.from("business_sources").insert({ agent_id: f.business.agent.id, url: "https://sole.example/info.pdf", origin: "link", visibility: "public", status: "ok", kind: "pdf", content: "Info\nVegan dishes every day.", last_read_at: new Date().toISOString() }).select("id").single();
    await offerings.readOfferings(doc!.id);
    expect(await facility("vegan_options")).toMatchObject({ status: "yes", confirmed: false });
    expect(await actions.removeFacilityAction("vegan_options")).toEqual({});
    await offerings.readOfferings(doc!.id, { force: true });
    expect(await facility("vegan_options")).toMatchObject({ hidden: true, confirmed: true });
    expect(await offerings.offeringsKnowledgeFor(f.business.agent.id, "public")).not.toContain("Vegan");
    // Adding it again brings it back.
    await actions.saveFacilityAction({ key: "vegan_options", label: null, status: "yes", note: null });
    expect(await facility("vegan_options")).toMatchObject({ hidden: false, status: "yes" });
  });

  it("products and services: options, tags, service details; a renamed item is still recognised by the next read", async () => {
    const { actions, offerings } = await lib();
    const { data: doc } = await f.db.from("business_sources").insert({ agent_id: f.business.agent.id, url: "https://sole.example/pizza.pdf", origin: "link", visibility: "public", status: "ok", kind: "pdf", content: "Pizza\nDiavola (HOT) £10\nCapricciosa (10-inch) £8\nCapricciosa (12-inch) £9.50", last_read_at: new Date().toISOString() }).select("id").single();
    await offerings.readOfferings(doc!.id);
    const capricciosa = (await prices()).filter((x) => x.found_item === "Capricciosa");
    expect(capricciosa).toHaveLength(2);
    expect(new Set(capricciosa.map((x) => x.group_id)).size).toBe(1); // one item, two options
    expect((await prices()).find((x) => x.item === "Diavola")).toMatchObject({ category: "Pizza", tags: ["Spicy"], kind: "product" });
    // Renamed, one option dropped (hidden, as it came from the document), a tag added.
    const big = capricciosa.find((x) => x.variant === "12-inch")!;
    expect(await actions.saveItemAction(asInput(capricciosa, { item: "Capricciosa (house)", tags: ["Popular"], options: [{ id: big.id, label: "12-inch", price: 9.5 }] }))).toEqual({ group_id: big.group_id });
    const edited = (await prices()).filter((x) => x.group_id === big.group_id);
    expect(edited.map((x) => [x.item, x.variant, x.hidden, x.corrected]).sort()).toEqual([["Capricciosa (house)", "10-inch", true, true], ["Capricciosa (house)", "12-inch", false, true]]);
    // The document changes: no second Capricciosa; what it says is noted on the business's own version.
    await f.db.from("business_sources").update({ content: "Pizza\nDiavola (HOT) £10\nCapricciosa (10-inch) £8\nCapricciosa (12-inch) £9.90" }).eq("id", doc!.id);
    await offerings.readOfferings(doc!.id);
    const after = (await prices()).filter((x) => /capricciosa/i.test(x.item));
    expect(after).toHaveLength(2);
    expect(after.find((x) => x.variant === "12-inch")).toMatchObject({ item: "Capricciosa (house)", found_price: 9.9 });
    // A service: priced "from", with how long it takes and booking; the agent knows it.
    const service = { group_id: null, kind: "service" as const, category: "Events", item: "Room hire", description: "Private room for up to 20", tags: [], price_type: "from" as const, currency: "GBP", duration_minutes: 120, needs_booking: true, options: [{ id: null, label: null, price: 150 }] };
    expect(await actions.saveItemAction(service)).toHaveProperty("group_id");
    expect(await offerings.offeringsKnowledgeFor(f.business.agent.id, "public")).toContain("- Events › Room hire: from £150.00, 2 h, booking needed. Private room for up to 20 (confirmed by the business)");
    // Two options with the same name are refused.
    expect(await actions.saveItemAction({ ...service, item: "Lessons", options: [{ id: null, label: "Adult", price: 20 }, { id: null, label: "adult", price: 15 }] })).toHaveProperty("error");
  });

  it("a long menu is read in parts, side by side; a read that fails keeps what was there and says why", async () => {
    const { offerings } = await lib();
    const { llm, setLLMProviderForTesting } = await import("@/lib/llm");
    const dishes = Array.from({ length: 200 }, (_, i) => `Curry number ${i + 1} with rice and naan £${(5 + i / 10).toFixed(2)}`);
    const content = `Mains\n${dishes.join("\n")}`;
    expect(content.length).toBeGreaterThan(8000);
    const { data: doc } = await f.db.from("business_sources").insert({ agent_id: f.business.agent.id, url: "https://sole.example/long-menu", origin: "link", visibility: "public", status: "ok", kind: "page", content, last_read_at: new Date().toISOString() }).select("id").single();
    const real = llm();
    let calls = 0;
    setLLMProviderForTesting({ ...real, name: real.name, generateText: real.generateText.bind(real), generateObject: (req) => { calls++; return real.generateObject(req); } } as typeof real);
    try {
      await offerings.readOfferings(doc!.id);
    } finally { setLLMProviderForTesting(undefined); }
    expect(calls).toBeGreaterThan(2);
    const read = (await prices()).filter((x) => x.source_url === "https://sole.example/long-menu");
    expect(read).toHaveLength(200);
    const source = async () => (await f.db.from("business_sources").select("offerings_error, offerings_read_at").eq("id", doc!.id).single()).data!;
    expect(await source()).toMatchObject({ offerings_error: null, offerings_read_at: expect.any(String) });
    // The reader fails (twice, so the retry fails too): nothing is lost, and the source says why.
    setLLMProviderForTesting({ ...real, name: real.name, generateText: real.generateText.bind(real), generateObject: async () => { throw new Error("cut off"); } } as typeof real);
    try {
      await offerings.readOfferings(doc!.id, { force: true });
    } finally { setLLMProviderForTesting(undefined); }
    expect((await prices()).filter((x) => x.source_url === "https://sole.example/long-menu")).toHaveLength(200);
    expect((await source()).offerings_error).toBe("Prices couldn't be read from it this time.");
    // It works again: the note goes.
    await offerings.readOfferings(doc!.id, { force: true });
    expect((await source()).offerings_error).toBeNull();
  });
});
