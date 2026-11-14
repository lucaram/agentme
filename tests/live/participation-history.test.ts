import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbUp } from "./env";
import { planBusinessFixture } from "../fixtures/plan-business";
import { claimItem, closePollStep, respondRsvp, unclaimItem, votePoll } from "@/lib/plans/participation";
import { approveTask, cancelTask } from "@/lib/coordination/orchestrator";

describe.skipIf(!dbUp)("participant names, action times and history", () => {
  let f: Awaited<ReturnType<typeof planBusinessFixture>>;
  let poll: string;
  let assign: string;
  beforeAll(async () => {
    f = await planBusinessFixture();
    const { data, error } = await f.db.from("plan_steps").insert([
      { task_id: f.taskId, position: 1, type: "poll", status: "waiting", config: { question: "Dinner?", options: ["Pizza", "Sushi"], voters: [f.luca.agent.handle, f.marco.agent.handle, f.paul.agent.handle] } },
      { task_id: f.taskId, position: 2, type: "assign", status: "waiting", config: { title: "Bring along", items: ["Drinks", "Bread"], people: [f.luca.agent.handle, f.marco.agent.handle, f.paul.agent.handle] } },
    ]).select("id,type");
    if (error) throw error;
    poll = data!.find((s) => s.type === "poll")!.id;
    assign = data!.find((s) => s.type === "assign")!.id;
  });
  afterAll(async () => { await f?.cleanup(); });
  const history = async (action: string) => (await f.db.from("messages").select("content,created_at,metadata,conversation_id,sender_user_id").eq("metadata->>task_id", f.taskId).eq("metadata->>action", action)).data!;
  const answer = async (step: string) => (await f.db.from("step_responses").select("value,updated_at").eq("step_id", step).eq("agent_id", f.marco.agent.id).single()).data!;

  it("keeps vote changes while showing one current vote, with same-option retries preserving the original time", async () => {
    expect(await votePoll(poll, f.marco.userId, f.marco.agent, "Pizza")).toMatchObject({ ok: true });
    const first = await answer(poll);
    expect(await votePoll(poll, f.marco.userId, f.marco.agent, "Pizza")).toMatchObject({ ok: true });
    expect(await answer(poll)).toEqual(first);
    expect(await votePoll(poll, f.marco.userId, f.marco.agent, "Sushi")).toMatchObject({ ok: true });
    const latest = await answer(poll);
    expect(latest.value).toEqual({ option: "Sushi" });
    expect(Date.parse(latest.updated_at)).toBeGreaterThanOrEqual(Date.parse(first.updated_at));
    const rows = await history("vote");
    expect(rows).toHaveLength(4); // Two actions, each in the group and My Agent.
    for (const conversation of [f.group, f.myAgent]) {
      const actions = rows.filter((r) => r.conversation_id === conversation);
      expect(actions.map((r) => r.content)).toEqual(expect.arrayContaining(["Marco voted for Pizza.", "Marco changed their vote to Sushi."]));
      for (const row of actions) {
        expect(row.metadata).toMatchObject({ actor: { agent_id: f.marco.agent.id, name: "Marco", handle: f.marco.agent.handle } });
        expect(Number.isFinite(Date.parse(row.created_at))).toBe(true);
        expect(row.sender_user_id).toBeNull(); // Honest system activity, never a fake human message.
      }
    }
  });

  it("keeps an RSVP time stable for retries and records the changed answer in both places", async () => {
    expect(await respondRsvp(f.stepId, f.marco.userId, f.marco.agent, "out")).toMatchObject({ ok: true });
    const first = await answer(f.stepId);
    expect(await respondRsvp(f.stepId, f.marco.userId, f.marco.agent, "out")).toMatchObject({ ok: true });
    expect(await answer(f.stepId)).toEqual(first);
    expect(await respondRsvp(f.stepId, f.marco.userId, f.marco.agent, "in")).toMatchObject({ ok: true });
    expect((await answer(f.stepId)).value).toEqual({ response: "in" });
    expect(await history("rsvp")).toHaveLength(4);
  });

  it("retains a named claim and give-back after the current claim is removed", async () => {
    expect(await claimItem(assign, f.marco.userId, f.marco.agent, "Drinks")).toMatchObject({ ok: true });
    const { data: claim } = await f.db.from("item_claims").select("created_at").eq("step_id", assign).single();
    expect(Number.isFinite(Date.parse(claim!.created_at))).toBe(true);
    expect(await claimItem(assign, f.marco.userId, f.marco.agent, "Drinks")).toMatchObject({ ok: true });
    expect(await history("claim")).toHaveLength(2);
    expect(await unclaimItem(assign, f.marco.userId, f.marco.agent, "Drinks")).toMatchObject({ ok: true });
    expect((await f.db.from("item_claims").select("*").eq("step_id", assign)).data).toEqual([]);
    expect(await history("unclaim")).toHaveLength(2);
  });

  it("records a manual poll closure only once and rejects non-organisers and outsiders", async () => {
    expect(await closePollStep(poll, f.marco.userId)).toMatchObject({ ok: false });
    expect(await votePoll(poll, f.business.userId, f.business.agent, "Pizza")).toMatchObject({ ok: false });
    expect(await closePollStep(poll, f.luca.userId)).toMatchObject({ ok: true });
    expect(await closePollStep(poll, f.luca.userId)).toMatchObject({ ok: true });
    const rows = await history("close_poll");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.content.startsWith("Luca closed the poll."))).toBe(true);
  });

  it("records approvals privately and cancellations once, without notifying the group about the approval", async () => {
    const { data: task, error } = await f.db.from("tasks").insert({ owner_id: f.luca.userId, initiator_agent: f.luca.agent.id, conversation_id: f.myAgent, group_conversation_id: f.group, goal: "Private approval", parsed: { kind: "poll", participants: [] }, status: "awaiting_approval" }).select("id").single();
    if (error) throw error;
    expect(await approveTask(task!.id, f.luca.userId)).toBe(true);
    expect(await approveTask(task!.id, f.luca.userId)).toBe(false);
    const { data: approval } = await f.db.from("messages").select("conversation_id,created_at,metadata").eq("metadata->>task_id", task!.id).eq("metadata->>action", "approve");
    expect(approval).toHaveLength(1);
    expect(approval![0].conversation_id).toBe(f.myAgent);
    expect(approval![0].metadata).toMatchObject({ actor: { name: "Luca" } });
    expect(Number.isFinite(Date.parse(approval![0].created_at))).toBe(true);
    await cancelTask(task!.id, f.luca.userId);
    await cancelTask(task!.id, f.luca.userId);
    const { data: stopped } = await f.db.from("messages").select("conversation_id,content").eq("metadata->>task_id", task!.id).eq("metadata->>action", "cancel");
    expect(stopped).toHaveLength(2);
    expect(stopped!.every((r) => r.content === "Luca stopped this request.")).toBe(true);

    const { data: draft, error: draftError } = await f.db.from("tasks").insert({ owner_id: f.luca.userId, initiator_agent: f.luca.agent.id, conversation_id: f.myAgent, group_conversation_id: f.group, goal: "Unapproved private request", status: "awaiting_approval" }).select("id").single();
    if (draftError) throw draftError;
    await cancelTask(draft!.id, f.luca.userId);
    const { data: privateStop } = await f.db.from("messages").select("conversation_id").eq("metadata->>task_id", draft!.id).eq("metadata->>action", "cancel");
    expect(privateStop).toEqual([{ conversation_id: f.myAgent }]);
  });
});
