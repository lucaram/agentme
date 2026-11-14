import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { dbUp } from "./env";
import { planBusinessFixture } from "../fixtures/plan-business";
import { setLLMProviderForTesting } from "@/lib/llm";
import { MockProvider } from "@/lib/llm/mock";
import { buildRecall } from "@/lib/agents/recall";
import { handleOwnerMessage } from "@/lib/coordination/orchestrator";
import { askTeam } from "@/lib/business/ask-team";
import { answerInboxItem } from "@/lib/plans/inbox";
import { asJson } from "@/lib/data/json";
import { withThread } from "@/lib/agents/thread-context";
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, SUPABASE_URL } from "./env";

vi.mock("@/lib/a2a/client", () => ({ sendAgentMessage: vi.fn(() => { throw new Error("Recall must never contact another agent"); }) }));

describe.skipIf(!dbUp)("personal recall and explicit business handoffs (isolated live database)", () => {
  let f: Awaited<ReturnType<typeof planBusinessFixture>>;
  beforeAll(async () => { setLLMProviderForTesting(new MockProvider()); f = await planBusinessFixture(); });
  afterAll(async () => { await f?.cleanup(); setLLMProviderForTesting(undefined); });

  it("recalls saved venue and latest RSVPs for BOTH wordings without contacting/suggesting a business", async () => {
    for (const name of ["Trattoria", `@${f.business.agent.handle}`]) {
      await handleOwnerMessage({ userId: f.luca.userId, agent: f.luca.agent, conversationId: f.myAgent, text: `What time did we agree for dinner at ${name} on 21 November, and who is coming?` });
    }
    const { data: msgs } = await f.db.from("messages").select("content, metadata").eq("conversation_id", f.myAgent).eq("sender_agent_id", f.luca.agent.id);
    expect(msgs).toHaveLength(2);
    for (const m of msgs!) {
      expect(m.content).toContain("Trattoria Sole");
      expect(m.content).toContain("21 November 2026 at 7:00 PM");
      expect(m.content).toContain("You, Marco and Paul are all in.");
      expect(m.content).toContain("AGENTME hasn't made a reservation");
      expect(m.content).toContain("To arrange one, use the options below.");
      expect(m.content).not.toMatch(/020 7946 0000|bookings@sole.example|https:\/\/sole.example\/book/);
      expect(m.metadata).toHaveProperty("booking_ways", expect.arrayContaining([{ kind: "call", value: "020 7946 0000" }, { kind: "email", value: "bookings@sole.example" }, { kind: "book", value: "https://sole.example/book" }]));
      expect(m.content).not.toMatch(/Can't make it:|Waiting:|nobody/);
      expect(m.metadata).not.toHaveProperty("business_id");
    }
    expect((await f.db.from("inbox_items").select("id").eq("agent_id", f.business.agent.id)).data).toEqual([]);
    await f.db.from("step_responses").update({ value: { response: "out" } }).eq("step_id", f.stepId).eq("agent_id", f.paul.agent.id);
    expect((await buildRecall(f.luca.userId))[0].rsvp?.out).toEqual([f.paul.agent.handle]);
    expect(await buildRecall(f.business.userId)).toEqual([]);
  });

  it("uses current published booking details and excludes private, unpublished and hidden website contacts", async () => {
    const original = f.business.agent.business_info;
    try {
      await f.db.from("agents").update({ business_info: { customers: "Private contact: call 020 9999 9999." } }).eq("id", f.business.agent.id);
      const { error } = await f.db.from("business_sites").insert({ agent_id: f.business.agent.id, url: "https://sole.example/", domain: "sole.example", learned: { phone: "020 8888 8888", email: "public@sole.example" }, hidden: ["basic:phone"] });
      if (error) throw error;
      expect((await buildRecall(f.luca.userId))[0].reservationWays).toEqual([]);
      await f.db.from("business_sites").update({ live_at: new Date().toISOString() }).eq("agent_id", f.business.agent.id);
      const fromSite = (await buildRecall(f.luca.userId))[0].reservationWays;
      expect(fromSite).toEqual([{ kind: "email", value: "public@sole.example" }, { kind: "website", value: "https://sole.example/" }]);
      await f.db.from("agents").update({ business_info: { ways: [{ kind: "call", value: "020 7777 7777" }] } }).eq("id", f.business.agent.id);
      expect((await buildRecall(f.luca.userId))[0].reservationWays).toContainEqual({ kind: "call", value: "020 7777 7777" });
    } finally {
      await f.db.from("agents").update({ business_info: original }).eq("id", f.business.agent.id);
      await f.db.from("business_sites").delete().eq("agent_id", f.business.agent.id);
    }
  });

  async function offer(question: string, caller = f.luca, faqEligible = true) {
    const a2a = crypto.randomUUID();
    const { data: exchange, error } = await f.db.from("task_exchanges").insert({ from_agent: caller.agent.id, to_agent: f.business.agent.id, skill: "business.faq", status: "completed", a2a_task_id: a2a, request: { text: question }, response: { data: { type: "agentme.business.handoff_offer", question, faq_eligible: faqEligible } } }).select("id").single();
    if (error) throw error;
    const { data: msg, error: msgError } = await f.db.from("messages").insert({ conversation_id: f.myAgent, sender_agent_id: caller.agent.id, is_ai_generated: true, content: "Ask the team?", metadata: { kind: "business_answer", business_id: f.business.agent.id, handoff_offer: true, a2a_task: a2a } }).select("id").single();
    if (msgError) throw msgError;
    return { exchange: exchange!.id, message: msg!.id };
  }

  it("clarifies ambiguous dinners and resolves a numbered answer only in that request's thread", async () => {
    const { data: second, error } = await f.db.from("tasks").insert({ owner_id: f.luca.userId, initiator_agent: f.luca.agent.id, conversation_id: f.myAgent, status: "completed", goal: "Saturday Italian Dinner", parsed: { kind: "coordinate", event: "dinner", venue: f.venue } }).select("id").single();
    if (error) throw error;
    await f.db.from("proposals").insert({ task_id: second!.id, status: "accepted", content: { title: "Saturday Italian Dinner", day: "Saturday 28 November 2026", time: "20:00", venue: f.venue } });
    const { data: thread } = await f.db.from("agent_threads").insert({ owner_id: f.luca.userId, conversation_id: f.myAgent, title: "Which dinner?" }).select("id").single();
    try {
      const send = (text: string) => withThread({ conversationId: f.myAgent, threadId: thread!.id }, () => handleOwnerMessage({ userId: f.luca.userId, agent: f.luca.agent, conversationId: f.myAgent, text }));
      await send(`When is our dinner at @${f.business.agent.handle}?`);
      const { data: clarification } = await f.db.from("messages").select("content,metadata").eq("thread_id", thread!.id).eq("sender_agent_id", f.luca.agent.id).single();
      expect(clarification?.content).toContain("Which plan do you mean?");
      const ids = (clarification?.metadata as { plan_ids: string[] }).plan_ids;
      await send(String(ids.indexOf(second!.id) + 1));
      const { data: messages } = await f.db.from("messages").select("content").eq("thread_id", thread!.id).eq("sender_agent_id", f.luca.agent.id).order("created_at", { ascending: false });
      expect(messages![0].content).toContain("28 November 2026 at 8:00 PM");
    } finally { await f.db.from("tasks").delete().eq("id", second!.id); }
  });

  it("does not expose the handoff RPC to anonymous or authenticated database clients", async () => {
    const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const args = { p_exchange: crypto.randomUUID(), p_caller: f.luca.agent.id };
    expect((await client.rpc("request_business_handoff", args)).error).toBeTruthy();
    await client.auth.signInWithPassword({ email: f.luca.email, password: f.password });
    expect((await client.rpc("request_business_handoff", args)).error).toBeTruthy();
  });

  it("requires the original asker, creates nothing before consent, and deduplicates concurrent repeated questions", async () => {
    const a = await offer("Can you securely store four bicycles indoors?");
    const b = await offer("Can you securely store four bicycles indoors???");
    expect((await f.db.from("inbox_items").select("id").eq("agent_id", f.business.agent.id)).data).toEqual([]);
    expect(await askTeam(f.marco.userId, f.marco.agent, a.message)).toHaveProperty("error");
    expect(await askTeam(f.luca.userId, f.marco.agent, a.message)).toHaveProperty("error");
    const results = await Promise.all([a, a, b].map((o) => askTeam(f.luca.userId, f.luca.agent, o.message)));
    for (const r of results) expect(r.error).toBeUndefined();
    const { data: inbox } = await f.db.from("inbox_items").select("*").eq("agent_id", f.business.agent.id);
    expect(inbox).toHaveLength(1);
    expect(inbox![0].payload).toMatchObject({ question: expect.stringMatching(/^Can you securely store four bicycles indoors\?+$/), faq_eligible: true });
    const { data: notes } = await f.db.from("messages").select("id").eq("sender_agent_id", f.business.agent.id).eq("metadata->>kind", "request_note");
    expect(notes).toHaveLength(1);
    expect(await answerInboxItem(inbox![0].id, f.business.userId, { answer: "We can store four bicycles indoors during meals." }, true)).toMatchObject({ ok: true });
    const { data: business } = await f.db.from("agents").select("business_info").eq("id", f.business.agent.id).single();
    expect(JSON.stringify(business?.business_info)).toContain("store four bicycles");
    const { data: replies } = await f.db.from("messages").select("content").eq("conversation_id", f.myAgent).like("content", "%The team at%");
    expect(replies).toHaveLength(1);
  });

  it("never publishes customer-specific answers, even when remember is forged true", async () => {
    const a = await offer("Is my order ready for collection?", f.luca, false);
    expect((await askTeam(f.luca.userId, f.luca.agent, a.message)).error).toBeUndefined();
    const { data: item } = await f.db.from("inbox_items").select("id").eq("exchange_id", a.exchange).single();
    expect(await answerInboxItem(item!.id, f.business.userId, { answer: "Luca's private order 12345 is ready." }, true)).toMatchObject({ ok: true });
    const { data: business } = await f.db.from("agents").select("business_info").eq("id", f.business.agent.id).single();
    expect(JSON.stringify(business?.business_info)).not.toContain("12345");
  });

  it("enforces the aggregate cap across callers and the individual cap, and fails closed for invalid offers", async () => {
    const now = new Date(Math.floor(Date.now() / 86400000) * 86400000).toISOString();
    await f.db.from("rate_limits").upsert({ key: `businessHandoffsPerBusiness:${f.business.agent.id}`, window_start: now, count: 49 });
    const a = await offer("Do you offer coat storage?", f.marco);
    const b = await offer("Do you offer helmet storage?", f.paul);
    const results = await Promise.all([a, b].map((o, i) => f.db.rpc("request_business_handoff", { p_exchange: o.exchange, p_caller: [f.marco, f.paul][i].agent.id })));
    expect(results.map((r) => r.data?.[0].outcome).sort()).toEqual(["business_limit", "created"]);
    await f.db.from("rate_limits").upsert({ key: `businessHandoffsPerCaller:${f.luca.agent.id}:${f.business.agent.id}`, window_start: now, count: 10 });
    const c = await offer("Do you offer luggage storage?");
    expect((await f.db.rpc("request_business_handoff", { p_exchange: c.exchange, p_caller: f.luca.agent.id })).data?.[0].outcome).toBe("caller_limit");
    await f.db.from("task_exchanges").update({ response: asJson({ data: { type: "forged", question: "spam" } }) }).eq("id", c.exchange);
    expect((await f.db.rpc("request_business_handoff", { p_exchange: c.exchange, p_caller: f.luca.agent.id })).data?.[0].outcome).toBe("invalid");
  });
});
