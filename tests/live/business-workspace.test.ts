import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, SUPABASE_URL, dbUp } from "./env";
import { planBusinessFixture } from "../fixtures/plan-business";
import { waysOf } from "@/lib/business/booking";
import { customerActivity } from "@/lib/business/answer-log";
import { answerInboxItem } from "@/lib/plans/inbox";
import { publicBusinessDetails } from "@/lib/business/details";

const auth = vi.hoisted(() => ({ agentId: "" }));
vi.mock("@/lib/auth", () => ({ requireAgent: async () => { const { getAgentById } = await import("@/lib/data/agents"); const agent = await getAgentById(auth.agentId); if (!agent) throw new Error("Not signed in"); return { agent, user: { id: agent.owner_id, businessRole: "owner" } }; } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

describe.skipIf(!dbUp)("business workspace compatibility and privacy", () => {
  let f: Awaited<ReturnType<typeof planBusinessFixture>>;
  beforeAll(async () => { f = await planBusinessFixture(); auth.agentId = f.business.agent.id; });
  afterAll(async () => { await f?.cleanup(); });
  const actions = () => import("@/app/(app)/business/actions");
  const read = async () => (await f.db.from("agents").select("business_info").eq("id", f.business.agent.id).single()).data!.business_info as Record<string, unknown>;

  it("separate forms preserve existing FAQs, actions and customer-only information", async () => {
    const { saveBusinessInfoAction, saveBusinessDetailsAction, saveWaysAction } = await actions();
    await f.db.from("agents").update({ business_info: { ...f.business.agent.business_info as object, customers: "Private events: secret conditions" } }).eq("id", f.business.agent.id);
    const about = new FormData(); about.set("about", "A welcoming public business introduction.");
    expect(await saveBusinessInfoAction(undefined, about)).toMatchObject({ saved: true });
    expect(await read()).toMatchObject({ about: "A welcoming public business introduction.", customers: "Private events: secret conditions", faqs: expect.any(Array), ways: expect.any(Array) });
    const customer = new FormData(); customer.set("customers", "Updated private customer terms");
    expect(await saveBusinessInfoAction(undefined, customer)).toMatchObject({ saved: true });
    const details = new FormData(); details.set("hours", "Every day 10–8"); details.set("address", "12 Public Street");
    expect(await saveBusinessDetailsAction(undefined, details)).toMatchObject({ saved: true });
    const many = Array.from({ length: 8 }, (_, i) => ({ kind: "book", value: `https://sole.example/book/${i}`, label: `Book ${i}`, primary: i === 7 }));
    expect(await saveWaysAction(many)).toMatchObject({ saved: true });
    const info = await read();
    expect(info).toMatchObject({ about: "A welcoming public business introduction.", customers: "Updated private customer terms", hours: "Every day 10–8", address: "12 Public Street", faqs: expect.any(Array) });
    expect(waysOf(info)).toEqual(many);
  });

  it("website corrections and undo preserve the business's original details and other information", async () => {
    const { fixLearnedAction, removeCorrectionAction } = await import("@/app/(app)/business/website-actions");
    const original = await read();
    expect(await fixLearnedAction({ kind: "basic", key: "hours", value: "Corrected hours" })).toEqual({});
    const corrected = await read();
    expect(publicBusinessDetails(corrected).hours).toBe("Corrected hours");
    expect(corrected).toMatchObject({ hours: original.hours, ways: original.ways, customers: original.customers, faqs: original.faqs });
    expect(await removeCorrectionAction("Opening hours")).toEqual({});
    expect(publicBusinessDetails(await read()).hours).toBe(original.hours);
  });

  it("a public document creates one reusable button; private or foreign sources cannot be published", async () => {
    const { createSourceButtonAction, setSourceVisibilityAction } = await actions();
    const { data: source } = await f.db.from("business_sources").insert({ agent_id: f.business.agent.id, url: "https://sole.example/menu.pdf", visibility: "public" }).select("id").single();
    expect(await createSourceButtonAction(source!.id, "View menu")).toEqual({});
    expect(await createSourceButtonAction(source!.id, "View menu")).toEqual({});
    expect(waysOf(await read()).filter((way) => way.label === "View menu")).toHaveLength(1);
    expect((await f.db.from("business_sources").select("id").eq("agent_id", f.business.agent.id)).data).toHaveLength(1);
    expect(await setSourceVisibilityAction(source!.id, "customers")).toEqual({});
    expect(waysOf(await read()).some((way) => way.label === "View menu")).toBe(false);
    expect(await createSourceButtonAction(source!.id, "Leaked menu")).toHaveProperty("error");
    const { data: foreign } = await f.db.from("business_sources").insert({ agent_id: f.marco.agent.id, url: "https://other.example/private", visibility: "public" }).select("id").single();
    expect(await createSourceButtonAction(foreign!.id, "Foreign document")).toHaveProperty("error");
  });

  it("counts each incoming question once, follows staff outcomes, and excludes previews", async () => {
    const { tryQuestionAction } = await actions();
    expect((await customerActivity(f.business.agent.id))?.received).toBe(0);
    await tryQuestionAction("What are your opening hours?", false);
    expect((await customerActivity(f.business.agent.id))?.received).toBe(0);
    const { data: exchanges, error } = await f.db.from("task_exchanges").insert([
      { from_agent: f.luca.agent.id, to_agent: f.business.agent.id, skill: "business.faq", status: "completed", answered_by: "agent", disclosed_categories: ["business_info"] },
      { from_agent: f.luca.agent.id, to_agent: f.business.agent.id, skill: "business.faq", status: "completed", answered_by: "agent", disclosed_categories: [], response: { data: { type: "agentme.business.handoff_offer", question: "Can you store bicycles?", faq_eligible: true } } },
      { from_agent: f.luca.agent.id, to_agent: f.business.agent.id, skill: "business.faq", status: "failed", disclosed_categories: [] },
    ]).select("id");
    if (error) throw error;
    expect(await customerActivity(f.business.agent.id)).toEqual({ received: 3, automatic: 1, team_answered: 0, unanswered: 2, awaiting_team: 0 });
    const request = { p_exchange: exchanges![1].id, p_caller: f.luca.agent.id };
    const first = await f.db.rpc("request_business_handoff", request);
    expect(first.data?.[0].outcome).toBe("created");
    await f.db.rpc("request_business_handoff", request);
    expect(await customerActivity(f.business.agent.id)).toEqual({ received: 3, automatic: 1, team_answered: 0, unanswered: 1, awaiting_team: 1 });
    expect(await answerInboxItem(first.data![0].item_id!, f.business.userId, { answer: "Yes, we can store bicycles." }, false)).toMatchObject({ ok: true });
    expect(await customerActivity(f.business.agent.id)).toEqual({ received: 3, automatic: 1, team_answered: 1, unanswered: 1, awaiting_team: 0 });
  });

  it("keeps the saved website in step with reconnects and clears it on deliberate removal", async () => {
    const { attachWebsite } = await import("@/lib/business/site-setup");
    const { removeWebsiteAction } = await import("@/app/(app)/business/website-actions");
    const original = await read();
    expect(await attachWebsite(f.business.agent.id, "first.example/menu/")).toEqual({ ok: true });
    expect(await read()).toMatchObject({ website: "https://first.example/menu/", customers: original.customers, ways: original.ways });
    expect(await attachWebsite(f.business.agent.id, "second.example/")).toEqual({ ok: true });
    expect(await read()).toMatchObject({ website: "https://second.example/", customers: original.customers, ways: original.ways });
    expect((await f.db.from("business_sites").select("url").eq("agent_id", f.business.agent.id).single()).data?.url).toBe("https://second.example/");
    expect(await removeWebsiteAction()).toEqual({});
    expect(await read()).toMatchObject({ website: null, customers: original.customers, ways: original.ways });
    expect((await f.db.from("business_sites").select("agent_id").eq("agent_id", f.business.agent.id)).data).toEqual([]);
  });

  it("denies direct access to the new service-only profile and activity RPCs", async () => {
    const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await client.auth.signInWithPassword({ email: f.luca.email, password: f.password });
    expect((await client.rpc("business_activity", { p_agent: f.business.agent.id })).error).toBeTruthy();
    expect((await client.rpc("patch_business_info", { p_agent: f.business.agent.id, p_patch: { about: "unauthorized" } })).error).toBeTruthy();
  });
});
