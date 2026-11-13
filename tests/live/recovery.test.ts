/**
 * Durable coordination: tasks interrupted by a server restart are resumed by
 * the sweeper, reusing replies that already arrived. Needs the local Supabase
 * stack and a mock-mode server at LIVE_TEST_URL (the orchestrator here runs
 * in-process and calls the other agents over real A2A HTTP).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIVE_URL, admin, agentIds, serverUp } from "./env";

process.env.APP_URL = LIVE_URL;

const created: string[] = [];
let ids: Awaited<ReturnType<typeof agentIds>>;
let conversationId: string;

const PARSED = { event: "dinner", window: "Saturday evening", participants: ["marco", "paul"], categories: ["availability", "food"] };
const past = () => new Date(Date.now() - 60_000).toISOString();

async function makeTask(fields: Record<string, unknown> = {}) {
  const { data, error } = await admin()
    .from("tasks")
    .insert({
      owner_id: ids.luca.owner_id,
      initiator_agent: ids.luca.id,
      conversation_id: conversationId,
      goal: "[test] Arrange dinner with @marco and @paul on Saturday evening",
      parsed: PARSED,
      status: "running",
      ...fields,
    })
    .select("id")
    .single();
  if (error) throw error;
  created.push(data.id);
  return data.id as string;
}

const orchestrator = () => import("@/lib/coordination/orchestrator");

/**
 * Runs a sweep, then waits for the task to leave "running". The server under
 * test runs its own sweeper too, so either worker may win the claim; the
 * outcome must be the same.
 */
async function recoverAndSettle(taskId: string) {
  const { recoverStuckTasks } = await orchestrator();
  await recoverStuckTasks();
  for (let i = 0; i < 60; i++) {
    const { data } = await admin().from("tasks").select("status").eq("id", taskId).single();
    if (data?.status !== "running") return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("task never left running");
}

describe.skipIf(!serverUp)("durable coordination (live)", () => {
  beforeAll(async () => {
    ids = await agentIds();
    const { data } = await admin()
      .from("conversations")
      .select("id")
      .eq("kind", "my_agent")
      .eq("created_by", ids.luca.owner_id)
      .single();
    conversationId = data!.id;
  });

  afterAll(async () => {
    if (!created.length) return;
    await admin().from("messages").delete().in("metadata->>task_id", created);
    await admin().from("tasks").delete().in("id", created); // cascades exchanges, proposals
  });

  it("resumes an interrupted task, reusing replies that already arrived", async () => {
    // Hold a live lease while seeding so the server's own sweeper can't start early.
    const taskId = await makeTask({ attempts: 1, lease_until: new Date(Date.now() + 60_000).toISOString() });
    const db = admin();
    // Marco's agent had already answered before the "crash"; Paul's call was in flight.
    const seeded = await Promise.all([
      db.from("task_exchanges").insert({
        task_id: taskId, from_agent: ids.luca.id, to_agent: ids.marco.id, skill: "coordination.availability", status: "completed",
        disclosed_categories: ["availability", "food"],
        response: { text: "ok", data: { type: "agentme.coordination.reply", availability: "Saturdays after 7 PM", food: "Italian", location: null, summary: "ok" } },
      }),
      db.from("task_exchanges").insert({ task_id: taskId, from_agent: ids.luca.id, to_agent: ids.paul.id, skill: "coordination.availability", status: "pending" }),
    ]);
    expect(seeded.map((r) => r.error)).toEqual([null, null]);
    await db.from("tasks").update({ lease_until: past() }).eq("id", taskId); // now simulate the crash

    await recoverAndSettle(taskId);

    const { data: task } = await db.from("tasks").select("*").eq("id", taskId).single();
    expect(task).toMatchObject({ status: "proposal_ready", attempts: 2, lease_until: null });

    const { data: exchanges } = await db.from("task_exchanges").select("to_agent, status, error").eq("task_id", taskId).order("created_at");
    const toMarco = exchanges!.filter((e) => e.to_agent === ids.marco.id);
    const toPaul = exchanges!.filter((e) => e.to_agent === ids.paul.id);
    expect(toMarco.map((e) => e.status)).toEqual(["completed"]); // reused, not asked again
    expect(toPaul.map((e) => e.status)).toEqual(["failed", "completed"]); // interrupted, then retried
    expect(toPaul[0].error).toMatch(/interrupted/i);

    const { data: proposal } = await db.from("proposals").select("content").eq("task_id", taskId).single();
    expect(proposal!.content).toMatchObject({ time: "19:30", participants: ["luca", "marco", "paul"] });
    const { count } = await db.from("messages").select("*", { count: "exact", head: true }).eq("metadata->>task_id", taskId);
    expect(count).toBe(1);

    // AI cost is attributed to the task, including the other agent's reply.
    const { data: usage } = await db.from("llm_usage").select("purpose, agent_id").eq("task_id", taskId);
    expect(usage!.map((u) => u.purpose).sort()).toEqual(["coordination_reply", "proposal"]);
    expect(usage!.find((u) => u.purpose === "coordination_reply")!.agent_id).toBe(ids.paul.id);
  });

  it("fails visibly after too many interruptions instead of hanging", async () => {
    const taskId = await makeTask({ interrupted_runs: 3, lease_until: past() });
    await recoverAndSettle(taskId);
    const { data: task } = await admin().from("tasks").select("status, error").eq("id", taskId).single();
    expect(task!.status).toBe("failed");
    expect(task!.error).toMatch(/interrupted several times/);
    const { data: msgs } = await admin().from("messages").select("content").eq("metadata->>task_id", taskId);
    expect(msgs!.map((m) => m.content)).toEqual([expect.stringMatching(/^I couldn't finish/)]);
  });

  it("being picked up many times is not being interrupted: people answering one by one never ends a plan", async () => {
    // A plan woken nine times before (each person's answer wakes it), every run ending in order.
    const taskId = await makeTask({ attempts: 9, interrupted_runs: 0, lease_until: past() });
    await recoverAndSettle(taskId);
    const { data: task } = await admin().from("tasks").select("status, error, attempts, interrupted_runs").eq("id", taskId).single();
    // It ran again and finished its step; the run ended in order, so the count of interruptions is back to zero.
    expect(task).toEqual({ status: "proposal_ready", error: null, attempts: 10, interrupted_runs: 0 });
  });

  it("an interrupted run counts once, and a run that then ends in order clears it", async () => {
    // Two runs in a row were interrupted; the third is picked up (3 of 3 allowed) and completes.
    const taskId = await makeTask({ attempts: 2, interrupted_runs: 2, lease_until: past() });
    await recoverAndSettle(taskId);
    const { data: task } = await admin().from("tasks").select("status, attempts, interrupted_runs").eq("id", taskId).single();
    expect(task).toEqual({ status: "proposal_ready", attempts: 3, interrupted_runs: 0 });
  });

  it("with concurrent workers, exactly one runs: one proposal, one message", async () => {
    const taskId = await makeTask();
    const { runTask } = await orchestrator();
    await Promise.all([runTask(taskId), runTask(taskId), runTask(taskId)]);
    const db = admin();
    const { data: task } = await db.from("tasks").select("status, attempts").eq("id", taskId).single();
    expect(task).toEqual({ status: "proposal_ready", attempts: 1 });
    const { count: proposals } = await db.from("proposals").select("*", { count: "exact", head: true }).eq("task_id", taskId);
    const { count: messages } = await db.from("messages").select("*", { count: "exact", head: true }).eq("metadata->>task_id", taskId);
    const { count: exchanges } = await db.from("task_exchanges").select("*", { count: "exact", head: true }).eq("task_id", taskId);
    expect([proposals, messages, exchanges]).toEqual([1, 1, 2]);
  });

  it("never steals a task whose worker is still alive", async () => {
    const future = new Date(Date.now() + 120_000).toISOString();
    const taskId = await makeTask({ attempts: 1, lease_until: future });
    const { recoverStuckTasks, runTask } = await orchestrator();
    await recoverStuckTasks();
    await runTask(taskId);
    const { data: task } = await admin().from("tasks").select("status, attempts").eq("id", taskId).single();
    expect(task).toEqual({ status: "running", attempts: 1 });
  });
});
