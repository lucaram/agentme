/**
 * Milestone 3 blocks against a real database and mock-mode server:
 * invitation + threshold/waitlist, sign-up list (Assign), Change, Announce.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIVE_URL, admin, agentIds, serverUp } from "./env";

process.env.APP_URL = LIVE_URL;

const created: string[] = [];
let ids: Awaited<ReturnType<typeof agentIds>>;
let conversationId: string;
type AgentLike = { id: string; handle: string; display_name: string; owner_id: string };
const agents: Record<string, AgentLike> = {};

const engine = () => import("@/lib/plans/engine");
const participation = () => import("@/lib/plans/participation");

async function makeTask(parsed: Record<string, unknown>, steps: { type: string; config?: unknown }[]) {
  const db = admin();
  const { data, error } = await db
    .from("tasks")
    .insert({ owner_id: ids.luca.owner_id, initiator_agent: ids.luca.id, conversation_id: conversationId, goal: "[test] m3", parsed, status: "running" })
    .select("*")
    .single();
  if (error) throw error;
  created.push(data.id);
  const { data: rows } = await db
    .from("plan_steps")
    .insert(steps.map((s, position) => ({ task_id: data.id, position, type: s.type, config: s.config ?? {} })))
    .select("id");
  const { runTask } = await engine();
  await runTask(data.id);
  return { taskId: data.id as string, stepIds: (rows ?? []).map((r) => r.id as string) };
}

const task = async (id: string) => (await admin().from("tasks").select("*").eq("id", id).single()).data!;
const events = async (conversation: string) =>
  ((await admin().from("messages").select("content, sender_user_id, sender_agent_id").eq("conversation_id", conversation).order("created_at")).data ?? [])
    .filter((m) => !m.sender_user_id && !m.sender_agent_id)
    .map((m) => m.content);

describe.skipIf(!serverUp)("Milestone 3 blocks (live)", () => {
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

  it("invitation: its own group, the organiser is in, minimum reached, waitlist moves up", async () => {
    const config = { title: "Five-a-side", day: "Thursday", time: "19:00", min: 2, max: 2 };
    const { taskId, stepIds } = await makeTask(
      { kind: "rsvp", event: "Five-a-side", window: "Thursday", participants: ["marco", "eve"], categories: [], time: "19:00", min: 2, max: 2 },
      [{ type: "rsvp", config }],
    );
    const t = await task(taskId);
    expect(t.status).toBe("accepted");
    const { data: proposal } = await admin().from("proposals").select("status, content, group_conversation_id").eq("task_id", taskId).single();
    expect(proposal).toMatchObject({ status: "accepted", group_conversation_id: t.group_conversation_id, content: { title: "Five-a-side", day: "Thursday", time: "19:00" } });

    const { respondRsvp } = await participation();
    const rsvp = stepIds[0];
    await respondRsvp(rsvp, ids.marco.owner_id, agents.marco as never, "in");
    await respondRsvp(rsvp, ids.eve.owner_id, agents.eve as never, "in");
    await respondRsvp(rsvp, ids.marco.owner_id, agents.marco as never, "out");
    expect(await events(t.group_conversation_id!)).toEqual([
      "Marco is in ✅",
      "It's on! ✅ 2 of 2 needed are in.",
      "Eve is on the waitlist (#1) — the plan is full (2 max).",
      "Marco changed their answer: can't make it ❌",
      "Eve moved up from the waitlist: is in ✅",
    ]);
  });

  it("sign-up list: people claim their own items, never twice, and it completes", async () => {
    const config = { title: "Who brings what", items: ["drinks", "dessert"], people: ["luca", "marco", "eve"] };
    const { taskId, stepIds } = await makeTask(
      { kind: "assign", event: "Who brings what", window: "", participants: ["marco", "eve"], categories: [], items: config.items },
      [{ type: "assign", config }],
    );
    expect((await task(taskId)).status).toBe("waiting");
    const { claimItem, unclaimItem } = await participation();
    const step = stepIds[0];
    expect(await claimItem(step, ids.marco.owner_id, agents.marco as never, "drinks")).toEqual({ ok: true });
    expect(await claimItem(step, ids.eve.owner_id, agents.eve as never, "drinks")).toEqual({ ok: false, error: "Already taken by @marco." });
    expect(await claimItem(step, ids.eve.owner_id, agents.eve as never, "cake")).toEqual({ ok: false, error: "That isn't on the list." });
    expect(await claimItem(step, ids.paul.owner_id, agents.paul as never, "dessert")).toEqual({ ok: false, error: "Not found." });
    expect(await unclaimItem(step, ids.eve.owner_id, agents.eve as never, "drinks")).toEqual({ ok: false, error: "You haven't claimed that." });

    // Two people grab the last item at the same moment: exactly one wins.
    const race = await Promise.all([
      claimItem(step, ids.eve.owner_id, agents.eve as never, "dessert"),
      claimItem(step, ids.luca.owner_id, agents.luca as never, "dessert"),
    ]);
    expect(race.filter((r) => r.ok).length).toBe(1);
    const { data: claims } = await admin().from("item_claims").select("item").eq("step_id", step);
    expect(claims!.map((c) => c.item).sort()).toEqual(["dessert", "drinks"]);

    const { runTask } = await engine();
    await runTask(taskId);
    const t = await task(taskId);
    expect(t.status).toBe("completed");
    expect(await events(t.group_conversation_id!)).toContain("Everything is covered ✅");
  });

  it("change: a new time resets other people's answers and is kept in the history", async () => {
    const config = { title: "Drinks", day: "Friday", time: "20:00" };
    const { taskId, stepIds } = await makeTask(
      { kind: "rsvp", event: "Drinks", window: "Friday", participants: ["marco", "eve"], categories: [], time: "20:00" },
      [{ type: "rsvp", config }],
    );
    const { respondRsvp } = await participation();
    await respondRsvp(stepIds[0], ids.marco.owner_id, agents.marco as never, "in");
    const { data: proposal } = await admin().from("proposals").select("id").eq("task_id", taskId).single();
    const { changePlan } = await import("@/lib/plans/change");

    expect(await changePlan(proposal!.id, ids.marco.owner_id, { title: "Drinks", day: "Friday", time: "21:00" })).toEqual({ ok: false, error: "Not found." });
    expect(await changePlan(proposal!.id, ids.luca.owner_id, { title: "Drinks", day: "Friday", time: "9pm" })).toMatchObject({ ok: false });

    expect(await changePlan(proposal!.id, ids.luca.owner_id, { title: "Drinks", day: "Saturday", time: "21:00" })).toEqual({ ok: true, warnings: [] });
    const { data: answers } = await admin().from("step_responses").select("agent_id").eq("step_id", stepIds[0]);
    expect(answers!.map((r) => r.agent_id)).toEqual([ids.luca.id]); // only the organiser stays "in"
    const { data: changes } = await admin().from("plan_changes").select("before, after, reset_rsvps").eq("task_id", taskId);
    expect(changes).toEqual([
      { before: { title: "Drinks", day: "Friday", time: "20:00" }, after: { title: "Drinks", day: "Saturday", time: "21:00" }, reset_rsvps: true },
    ]);
    const t = await task(taskId);
    expect(await events(t.group_conversation_id!)).toContain("Luca changed the plan: Drinks, Saturday at 9:00 PM (was Friday at 8:00 PM). Please confirm again.");

    // Renaming only doesn't ask anyone to re-confirm.
    await respondRsvp(stepIds[0], ids.marco.owner_id, agents.marco as never, "in");
    await changePlan(proposal!.id, ids.luca.owner_id, { title: "Saturday drinks", day: "Saturday", time: "21:00" });
    const { count } = await admin().from("step_responses").select("*", { count: "exact", head: true }).eq("step_id", stepIds[0]);
    expect(count).toBe(2);
  });

  it("announce: the organiser's exact words, as their own message, in a new group", async () => {
    const message = "The trip is tomorrow, bring lunch!";
    const { taskId } = await makeTask({ kind: "announce", event: "", window: "", participants: ["marco", "eve"], categories: [], message }, [
      { type: "announce", config: { message, participants: ["marco", "eve"] } },
    ]);
    const t = await task(taskId);
    expect(t.status).toBe("completed");
    const { data: msgs } = await admin().from("messages").select("content, sender_user_id, sender_agent_id, is_ai_generated").eq("conversation_id", t.group_conversation_id!);
    expect(msgs).toEqual([{ content: message, sender_user_id: ids.luca.owner_id, sender_agent_id: null, is_ai_generated: false }]);
  });
});
