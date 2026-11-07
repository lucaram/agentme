/**
 * Milestone 4: composed plans run end to end, and drafts can be edited only
 * before approval, only by the organiser, with the same code checks.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIVE_URL, admin, agentIds, serverUp } from "./env";

process.env.APP_URL = LIVE_URL;

const created: string[] = [];
let ids: Awaited<ReturnType<typeof agentIds>>;
let conversationId: string;
type AgentLike = { id: string; handle: string; display_name: string; owner_id: string };
const agents: Record<string, AgentLike> = {};

async function insertComposed(text: string, status: "running" | "awaiting_approval") {
  const { heuristicCompose, validateDraft } = await import("@/lib/plans/compose");
  const v = validateDraft(heuristicCompose(text), { organiser: "luca", participants: ["marco", "eve"] });
  if (!v.ok) throw new Error(v.error);
  const db = admin();
  const { data, error } = await db
    .from("tasks")
    .insert({ owner_id: ids.luca.owner_id, initiator_agent: ids.luca.id, conversation_id: conversationId, goal: `[test] ${text}`, parsed: v.parsed, status })
    .select("id")
    .single();
  if (error) throw error;
  created.push(data.id);
  const { createSteps } = await import("@/lib/plans/steps");
  await createSteps(data.id, v.steps);
  return data.id as string;
}

describe.skipIf(!serverUp)("Milestone 4: composed plans (live)", () => {
  beforeAll(async () => {
    ids = await agentIds();
    const { data } = await admin().from("agents").select("id, handle, display_name, owner_id");
    for (const a of data ?? []) agents[a.handle] = a;
    conversationId = (await admin().from("conversations").select("id").eq("kind", "my_agent").eq("created_by", ids.luca.owner_id).single()).data!.id;
  });

  afterAll(async () => {
    const db = admin();
    if (!created.length) return;
    const { data: groups } = await db.from("tasks").select("group_conversation_id").in("id", created);
    await db.from("messages").delete().in("metadata->>task_id", created);
    await db.from("tasks").delete().in("id", created);
    const groupIds = (groups ?? []).map((g) => g.group_conversation_id).filter(Boolean) as string[];
    if (groupIds.length) await db.from("conversations").delete().in("id", groupIds);
  });

  it("an invitation + sign-up list runs in one shared group", async () => {
    const taskId = await insertComposed("Organise five-a-side on Thursday at 7pm with @marco and @eve, need 3, someone bring a ball and bibs", "running");
    const { runTask } = await import("@/lib/plans/engine");
    await runTask(taskId);

    const db = admin();
    const { data: task } = await db.from("tasks").select("status, group_conversation_id").eq("id", taskId).single();
    expect(task!.status).toBe("waiting"); // invitation done; waiting for the sign-up list
    const { data: posted } = await db.from("messages").select("metadata").eq("conversation_id", task!.group_conversation_id!);
    expect(posted!.map((m) => (m.metadata as { kind: string }).kind).sort()).toEqual(["assign", "proposal"]);

    const { data: steps } = await db.from("plan_steps").select("id, type, status").eq("task_id", taskId).order("position");
    expect(steps!.map((s) => [s.type, s.status])).toEqual([
      ["rsvp", "done"],
      ["assign", "waiting"],
    ]);
    const { claimItem } = await import("@/lib/plans/participation");
    const assign = steps!.find((s) => s.type === "assign")!.id;
    await claimItem(assign, ids.marco.owner_id, agents.marco as never, "ball");
    const last = await claimItem(assign, ids.eve.owner_id, agents.eve as never, "bibs");
    expect(last).toEqual({ ok: true, wake: taskId });
    await runTask(taskId);
    expect((await db.from("tasks").select("status").eq("id", taskId).single()).data!.status).toBe("accepted");
  });

  it("the organiser can edit the draft before approval, with the same checks", async () => {
    const taskId = await insertComposed("Ask @marco and @eve to vote: Italian, Thai or Indian", "awaiting_approval");
    const { updateDraft } = await import("@/lib/coordination/orchestrator");
    const { emptyStep } = await import("@/lib/plans/compose");
    const edited = { kind: "plan" as const, title: "Dinner vote", steps: [{ ...emptyStep("poll"), question: "Where?", options: ["Italian", "Sushi"] }] };

    expect(await updateDraft(taskId, ids.marco.owner_id, edited)).toEqual({ ok: false, error: "Not found." });
    expect(await updateDraft(taskId, ids.luca.owner_id, { ...edited, steps: [{ ...edited.steps[0], options: ["Only one"] }] })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/two options/),
    });
    expect(await updateDraft(taskId, ids.luca.owner_id, edited)).toEqual({ ok: true });
    const { data: steps } = await admin().from("plan_steps").select("type, config").eq("task_id", taskId);
    expect(steps).toEqual([{ type: "poll", config: { question: "Where?", options: ["Italian", "Sushi"], voters: ["luca", "marco", "eve"] } }]);

    // Once approved, the plan can no longer be edited.
    await admin().from("tasks").update({ status: "cancelled" }).eq("id", taskId);
    expect(await updateDraft(taskId, ids.luca.owner_id, edited)).toMatchObject({ ok: false, error: expect.stringMatching(/already approved or stopped/) });
  });
});
