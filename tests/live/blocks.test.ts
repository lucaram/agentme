/**
 * Milestone 2 blocks against a real database and mock-mode server:
 * Poll (code counts, humans vote), Question (always the person), RSVP v2.
 * Uses Luca + Marco + Eve so it never touches the demo "dinner" group.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIVE_URL, admin, agentIds, serverUp } from "./env";

process.env.APP_URL = LIVE_URL;

const createdTasks: string[] = [];
const createdGroups: string[] = [];
let ids: Awaited<ReturnType<typeof agentIds>>;
let conversationId: string;
type AgentLike = { id: string; handle: string; display_name: string; owner_id: string };
const agents: Record<string, AgentLike> = {};

const engine = () => import("@/lib/plans/engine");
const participation = () => import("@/lib/plans/participation");
const inbox = () => import("@/lib/plans/inbox");

async function makeTask(parsed: Record<string, unknown>, steps: { type: string; config?: unknown; status?: string }[], extra: Record<string, unknown> = {}) {
  const db = admin();
  const { data, error } = await db
    .from("tasks")
    .insert({ owner_id: ids.luca.owner_id, initiator_agent: ids.luca.id, conversation_id: conversationId, goal: "[test] blocks", parsed, status: "running", ...extra })
    .select("*")
    .single();
  if (error) throw error;
  createdTasks.push(data.id);
  const { data: rows } = await db
    .from("plan_steps")
    .insert(steps.map((s, position) => ({ task_id: data.id, position, type: s.type, config: s.config ?? {}, status: s.status ?? "pending" })))
    .select("id");
  return { task: data, stepIds: (rows ?? []).map((r) => r.id as string) };
}

const taskRow = async (id: string) => (await admin().from("tasks").select("*").eq("id", id).single()).data!;
const stepRow = async (id: string) => (await admin().from("plan_steps").select("*").eq("id", id).single()).data!;
const messages = async (conversation: string) =>
  ((await admin().from("messages").select("content, sender_user_id, sender_agent_id, is_ai_generated").eq("conversation_id", conversation).order("created_at")).data ?? []);

describe.skipIf(!serverUp)("poll, question and RSVP v2 (live)", () => {
  beforeAll(async () => {
    ids = await agentIds();
    const { data } = await admin().from("agents").select("id, handle, display_name, owner_id");
    for (const a of data ?? []) agents[a.handle] = a;
    conversationId = (await admin().from("conversations").select("id").eq("kind", "my_agent").eq("created_by", ids.luca.owner_id).single()).data!.id;
  });

  afterAll(async () => {
    const db = admin();
    const { data: groups } = await db.from("tasks").select("group_conversation_id").in("id", createdTasks);
    const groupIds = [...createdGroups, ...(groups ?? []).map((g) => g.group_conversation_id).filter(Boolean)] as string[];
    if (createdTasks.length) {
      await db.from("messages").delete().in("metadata->>task_id", createdTasks);
      await db.from("tasks").delete().in("id", createdTasks);
    }
    if (groupIds.length) await db.from("conversations").delete().in("id", groupIds);
  });

  it("poll: shared in a group, humans vote, code counts, closes when everyone voted", async () => {
    const config = { question: "Which day works better?", options: ["Saturday", "Sunday"], voters: ["luca", "marco", "eve"] };
    const { task, stepIds } = await makeTask({ kind: "poll", event: "", window: "", participants: ["marco", "eve"], categories: [], ...config }, [{ type: "poll", config }]);
    const { runTask } = await engine();
    await runTask(task.id);

    const t = await taskRow(task.id);
    expect(t.status).toBe("waiting");
    expect(t.group_conversation_id).toBeTruthy();
    const { data: members } = await admin().from("conversation_members").select("user_id").eq("conversation_id", t.group_conversation_id!);
    expect(new Set(members!.map((m) => m.user_id))).toEqual(new Set([ids.luca.owner_id, ids.marco.owner_id, ids.eve.owner_id]));

    const { votePoll } = await participation();
    expect(await votePoll(stepIds[0], ids.marco.owner_id, agents.marco as never, "Saturday")).toEqual({ ok: true });
    expect(await votePoll(stepIds[0], ids.paul.owner_id, agents.paul as never, "Saturday")).toEqual({ ok: false, error: "Not found." });
    expect(await votePoll(stepIds[0], ids.marco.owner_id, agents.marco as never, "Monday")).toEqual({ ok: false, error: "That isn't one of the options." });
    await votePoll(stepIds[0], ids.luca.owner_id, agents.luca as never, "Saturday");
    const last = await votePoll(stepIds[0], ids.eve.owner_id, agents.eve as never, "Sunday");
    expect(last).toEqual({ ok: true, wake: task.id });

    const step = await stepRow(stepIds[0]);
    expect(step.status).toBe("done");
    expect(step.result).toMatchObject({ closed: true, winners: ["Saturday"], counts: { Saturday: 2, Sunday: 1 } });
    await runTask(task.id);
    expect((await taskRow(task.id)).status).toBe("completed");
    expect((await messages(t.group_conversation_id!)).map((m) => m.content)).toContain("Poll closed: “Which day works better?” — Saturday (2 of 3 votes).");
    expect(await votePoll(stepIds[0], ids.marco.owner_id, agents.marco as never, "Sunday")).toEqual({ ok: false, error: "This poll is closed." });
  });

  it("poll: only the organiser can close it early", async () => {
    const config = { question: "Pizza or sushi?", options: ["Pizza", "Sushi"], voters: ["luca", "marco", "eve"] };
    const { task, stepIds } = await makeTask({ kind: "poll", event: "", window: "", participants: ["marco", "eve"], categories: [], ...config }, [{ type: "poll", config }]);
    const { runTask } = await engine();
    await runTask(task.id);
    const { votePoll, closePollStep } = await participation();
    await votePoll(stepIds[0], ids.marco.owner_id, agents.marco as never, "Sushi");
    expect(await closePollStep(stepIds[0], ids.marco.owner_id)).toEqual({ ok: false, error: "Only the organiser can close the poll." });
    expect(await closePollStep(stepIds[0], ids.luca.owner_id)).toEqual({ ok: true, wake: task.id });
    expect((await stepRow(stepIds[0])).result).toMatchObject({ closed: true, winners: ["Sushi"], votes: 1 });
  });

  it("question: goes to the person's inbox and their answer is relayed to the organiser", async () => {
    const config = { question: "Can you help me move on Sunday?", participants: ["marco"] };
    const { task } = await makeTask({ kind: "question", event: "", window: "", participants: ["marco"], categories: [], question: config.question }, [{ type: "question", config }]);
    const { runTask } = await engine();
    await runTask(task.id);
    expect((await taskRow(task.id)).status).toBe("waiting");

    const { data: item } = await admin().from("inbox_items").select("*").eq("task_id", task.id).single();
    expect(item).toMatchObject({ kind: "question", owner_id: ids.marco.owner_id, status: "open" });
    expect(item!.payload).toMatchObject({ question: "Can you help me move on Sunday?" });

    const { answerInboxItem } = await inbox();
    expect(await answerInboxItem(item!.id, ids.marco.owner_id, { answer: "" }, false)).toMatchObject({ ok: false });
    expect(await answerInboxItem(item!.id, ids.marco.owner_id, { answer: "Yes, from 10am!" }, false)).toEqual({ ok: true, wake: task.id });
    await runTask(task.id);

    expect((await taskRow(task.id)).status).toBe("completed");
    const { data: ex } = await admin().from("task_exchanges").select("status, answered_by, disclosed_categories, skill").eq("task_id", task.id).single();
    expect(ex).toEqual({ status: "completed", answered_by: "human", disclosed_categories: ["answer"], skill: "coordination.question" });
    const relayed = (await messages(conversationId)).filter((m) => m.content.includes("Yes, from 10am!"));
    expect(relayed).toEqual([
      { content: "💬 @marco answered personally: “Yes, from 10am!”", sender_user_id: null, sender_agent_id: ids.luca.id, is_ai_generated: true },
    ]);
  });

  it("question: declining is relayed too, and nothing else is shared", async () => {
    const config = { question: "Can I borrow your car?", participants: ["marco"] };
    const { task } = await makeTask({ kind: "question", event: "", window: "", participants: ["marco"], categories: [], question: config.question }, [{ type: "question", config }]);
    const { runTask } = await engine();
    await runTask(task.id);
    const { data: item } = await admin().from("inbox_items").select("id").eq("task_id", task.id).single();
    const { declineInboxItem } = await inbox();
    await declineInboxItem(item!.id, ids.marco.owner_id);
    await runTask(task.id);
    expect((await taskRow(task.id)).status).toBe("completed");
    expect((await messages(conversationId)).map((m) => m.content)).toContain("@marco preferred not to answer.");
  });

  it("RSVP v2: three states, editable, with neutral event lines", async () => {
    const db = admin();
    const { data: group } = await db.from("conversations").insert({ kind: "group", title: "[test] rsvp", created_by: ids.luca.owner_id }).select("id").single();
    createdGroups.push(group!.id);
    await db.from("conversation_members").insert([ids.luca, ids.marco, ids.eve].map((a) => ({ conversation_id: group!.id, user_id: a.owner_id })));
    const { stepIds } = await makeTask(
      { kind: "coordinate", event: "dinner", window: "Saturday", participants: ["marco", "eve"], categories: ["availability"] },
      [{ type: "rsvp", status: "done" }],
      { status: "accepted", group_conversation_id: group!.id },
    );
    const { respondRsvp } = await participation();
    expect(await respondRsvp(stepIds[0], ids.marco.owner_id, agents.marco as never, "in")).toEqual({ ok: true });
    expect(await respondRsvp(stepIds[0], ids.marco.owner_id, agents.marco as never, "in")).toEqual({ ok: true }); // no-op
    expect(await respondRsvp(stepIds[0], ids.marco.owner_id, agents.marco as never, "out")).toEqual({ ok: true });
    expect(await respondRsvp(stepIds[0], ids.paul.owner_id, agents.paul as never, "in")).toEqual({ ok: false, error: "Not found." });

    const { data: answer } = await db.from("step_responses").select("value, answered_by").eq("step_id", stepIds[0]).eq("agent_id", ids.marco.id).single();
    expect(answer).toEqual({ value: { response: "out" }, answered_by: "human" });
    const events = (await messages(group!.id)).filter((m) => !m.sender_user_id && !m.sender_agent_id).map((m) => m.content);
    expect(events).toEqual(["Marco is in ✅", "Marco changed their answer: can't make it ❌"]);
  });
});
