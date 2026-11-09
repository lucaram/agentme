/**
 * "Ask my human": when a contact's agent needs something the recipient's agent
 * may not share, the request waits in the recipient's inbox and the plan
 * resumes when they answer. Needs the local Supabase stack and a mock-mode
 * server at LIVE_TEST_URL (agents talk over real A2A HTTP).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, LIVE_URL, SUPABASE_URL, admin, agentIds, serverUp } from "./env";

process.env.APP_URL = LIVE_URL;

const PAUL_AVAILABILITY = "Saturdays after 6 PM";
const PARSED = { event: "dinner", window: "Saturday evening", participants: ["marco", "paul"], categories: ["availability", "food"] };
const created: string[] = [];
let ids: Awaited<ReturnType<typeof agentIds>>;
let conversationId: string;

const engine = () => import("@/lib/plans/engine");
const inbox = () => import("@/lib/plans/inbox");

async function setPaulAvailability(value: string, disclosure: "private" | "contacts") {
  await admin()
    .from("agent_facts")
    .upsert({ agent_id: ids.paul.id, category: "availability", label: "", value, disclosure }, { onConflict: "agent_id,category,label" });
}

async function startTask() {
  const { data, error } = await admin()
    .from("tasks")
    .insert({
      owner_id: ids.luca.owner_id,
      initiator_agent: ids.luca.id,
      conversation_id: conversationId,
      goal: "[test] inbox",
      parsed: PARSED,
      status: "running",
    })
    .select("id")
    .single();
  if (error) throw error;
  created.push(data.id);
  const { runTask } = await engine();
  await runTask(data.id);
  return data.id as string;
}

const task = async (id: string) => (await admin().from("tasks").select("status, error").eq("id", id).single()).data!;
const itemFor = async (taskId: string) => (await admin().from("inbox_items").select("*").eq("task_id", taskId).single()).data!;
const paulExchanges = async (taskId: string) =>
  (await admin().from("task_exchanges").select("status, answered_by, disclosed_categories, error").eq("task_id", taskId).eq("to_agent", ids.paul.id).order("created_at")).data!;

describe.skipIf(!serverUp)("ask my human: inbox (live)", () => {
  beforeAll(async () => {
    ids = await agentIds();
    const { data } = await admin().from("conversations").select("id").eq("kind", "my_agent").eq("created_by", ids.luca.owner_id).single();
    conversationId = data!.id;
  });
  beforeEach(() => setPaulAvailability(PAUL_AVAILABILITY, "private"));
  afterAll(async () => {
    await setPaulAvailability(PAUL_AVAILABILITY, "contacts");
    if (!created.length) return;
    await admin().from("messages").delete().in("metadata->>task_id", created);
    await admin().from("tasks").delete().in("id", created);
  });

  it("waits for the person, then continues with their answer", async () => {
    const taskId = await startTask();
    expect(await task(taskId)).toMatchObject({ status: "waiting" });
    expect(await paulExchanges(taskId)).toEqual([{ status: "waiting_human", answered_by: null, disclosed_categories: [], error: null }]);

    const item = await itemFor(taskId);
    expect(item).toMatchObject({ owner_id: ids.paul.owner_id, from_agent: ids.luca.id, status: "open" });
    expect(item.payload.missing).toEqual(["availability"]);
    expect(JSON.stringify(item.payload)).not.toContain(PAUL_AVAILABILITY); // private value not copied anywhere

    const { answerInboxItem } = await inbox();
    const result = await answerInboxItem(item.id, ids.paul.owner_id, { availability: "Saturdays after 8 PM" }, false);
    expect(result).toEqual({ ok: true, wake: taskId });
    const { runTask } = await engine();
    await runTask(taskId);

    expect(await task(taskId)).toMatchObject({ status: "proposal_ready" });
    expect(await paulExchanges(taskId)).toEqual([
      // food is shared too: Paul already allows it for contacts (the form shows it as "shared anyway").
      { status: "completed", answered_by: "human", disclosed_categories: ["availability", "food"], error: null },
    ]);
    const { data: proposal } = await admin().from("proposals").select("content").eq("task_id", taskId).single();
    expect(proposal!.content).toMatchObject({ time: "20:30", participants: ["luca", "marco", "paul"] });
    // Without "remember", Paul's availability stays private.
    const { data: fact } = await admin().from("agent_facts").select("disclosure").eq("agent_id", ids.paul.id).eq("category", "availability").single();
    expect(fact!.disclosure).toBe("private");
  });

  it("'remember' turns the answer into a standing permission", async () => {
    const taskId = await startTask();
    const { answerInboxItem } = await inbox();
    await answerInboxItem((await itemFor(taskId)).id, ids.paul.owner_id, { availability: "Saturdays after 7 PM" }, true);
    const { data: fact } = await admin().from("agent_facts").select("value, disclosure").eq("agent_id", ids.paul.id).eq("category", "availability").single();
    expect(fact).toEqual({ value: "Saturdays after 7 PM", disclosure: "contacts" });
  });

  it("declining shares nothing and the plan continues without them", async () => {
    const taskId = await startTask();
    const { declineInboxItem } = await inbox();
    expect(await declineInboxItem((await itemFor(taskId)).id, ids.paul.owner_id)).toEqual({ ok: true, wake: taskId });
    const { runTask } = await engine();
    await runTask(taskId);
    expect(await task(taskId)).toMatchObject({ status: "proposal_ready" });
    expect(await paulExchanges(taskId)).toEqual([
      { status: "refused", answered_by: "human", disclosed_categories: [], error: "@paul preferred not to share." },
    ]);
    const { data: proposal } = await admin().from("proposals").select("content").eq("task_id", taskId).single();
    expect((proposal!.content as { participants: string[] }).participants).toEqual(["luca", "marco"]);
  });

  it("the organiser can continue without waiting; the open request is withdrawn", async () => {
    const taskId = await startTask();
    const { continueWithoutWaiting, runTask } = await engine();
    expect(await continueWithoutWaiting(taskId, ids.marco.owner_id)).toBe(false); // only the organiser
    expect(await continueWithoutWaiting(taskId, ids.luca.owner_id)).toBe(true);
    await runTask(taskId);
    expect(await task(taskId)).toMatchObject({ status: "proposal_ready" });
    expect((await itemFor(taskId)).status).toBe("withdrawn");
  });

  it("cancelling the plan withdraws the request", async () => {
    const taskId = await startTask();
    const { cancelTask } = await import("@/lib/coordination/orchestrator");
    await cancelTask(taskId, ids.luca.owner_id);
    expect((await itemFor(taskId)).status).toBe("withdrawn");
    const { answerInboxItem } = await inbox();
    expect(await answerInboxItem((await itemFor(taskId)).id, ids.paul.owner_id, { availability: "x" }, false)).toEqual({
      ok: false,
      error: "This request is no longer open.",
    });
  });

  it("only the owner can see or answer their inbox", async () => {
    const taskId = await startTask();
    const item = await itemFor(taskId);
    const { answerInboxItem } = await inbox();
    expect(await answerInboxItem(item.id, ids.luca.owner_id, { availability: "Any time" }, false)).toEqual({ ok: false, error: "Not found." });

    const signIn = async (handle: string) => {
      const c = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
      await c.auth.signInWithPassword({ email: `${handle}@agentme.test`, password: "password123" });
      return c;
    };
    const asPaul = await (await signIn("paul")).from("inbox_items").select("id").eq("id", item.id);
    const asLuca = await (await signIn("luca")).from("inbox_items").select("id").eq("id", item.id);
    expect([asPaul.data?.length, asLuca.data?.length]).toEqual([1, 0]);
  });
});
