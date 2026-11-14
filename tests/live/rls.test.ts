/**
 * Row Level Security: a signed-in user talking to Supabase directly (bypassing
 * the app) can't read other people's private data or write anything.
 * Requires the local Supabase stack + seed; skipped otherwise.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ANON_KEY as ANON, SUPABASE_URL as URL, admin, agentIds, dbUp as up } from "./env";

describe.skipIf(!up)("RLS isolation (live)", () => {
  let eve: SupabaseClient;
  beforeAll(async () => {
    eve = createClient(URL!, ANON!, { auth: { persistSession: false } });
    const { error } = await eve.auth.signInWithPassword({ email: "eve@agentme.test", password: "password123" });
    expect(error).toBeNull();
  });

  it("only sees her own facts", async () => {
    const { data } = await eve.from("agent_facts").select("value");
    expect(data?.map((f) => f.value)).toEqual(["Any evening"]);
  });

  it("cannot read other people's conversations, messages, tasks or exchanges", async () => {
    for (const table of ["messages", "tasks", "proposals"] as const) {
      const { data } = await eve.from(table).select("id");
      // Eve may only see rows from her own conversations/tasks.
      const { data: mine } = await eve.from("conversation_members").select("conversation_id");
      if (table === "messages") {
        const ids = new Set(mine?.map((m) => m.conversation_id));
        const { data: rows } = await eve.from("messages").select("conversation_id");
        expect(rows?.every((r) => ids.has(r.conversation_id))).toBe(true);
      } else {
        expect(data).toEqual([]);
      }
    }
    const { data: exchanges } = await eve.from("task_exchanges").select("from_agent, to_agent, disclosed_categories");
    expect(exchanges?.every((e) => e.disclosed_categories.length === 0)).toBe(true);
  });

  it("sees businesses' names but never their private columns (e.g. “For customers only”)", async () => {
    const { data } = await eve.from("agents").select("handle, display_name, type").eq("handle", "trattoria");
    expect(data).toEqual([{ handle: "trattoria", display_name: expect.any(String), type: "business" }]);
    for (const column of ["business_info", "contact_sources", "discoverable", "recommendations_ok", "group_add_policy", "*"]) {
      const { error } = await eve.from("agents").select(column).limit(1);
      expect(error?.message, column).toContain("permission denied");
    }
  });

  it("cannot write directly, even to her own rows", async () => {
    const { data: agent } = await eve.from("agents").select("id").eq("handle", "eve").single();
    const insertFact = await eve.from("agent_facts").insert({ agent_id: agent!.id, category: "food", value: "x", disclosure: "contacts" });
    expect(insertFact.error).not.toBeNull();
    const update = await eve.from("agents").update({ display_name: "Mallory" }).eq("handle", "marco").select();
    expect(update.data ?? []).toEqual([]);
    const contact = await eve.from("contacts").insert({ requester_agent: agent!.id, addressee_agent: agent!.id, status: "accepted" });
    expect(contact.error).not.toBeNull();
  });
});

describe.skipIf(!up)("RLS: plans shared in a group (live)", () => {
  const db = admin();
  const signIn = async (handle: string) => {
    const c = createClient(URL!, ANON!, { auth: { persistSession: false } });
    await c.auth.signInWithPassword({ email: `${handle}@agentme.test`, password: "password123" });
    return c;
  };
  let taskId: string;
  let proposalId: string;
  let groupId: string;
  let stepId: string;

  beforeAll(async () => {
    const ids = await agentIds();
    const { data: conv } = await db.from("conversations").select("id").eq("kind", "my_agent").eq("created_by", ids.luca.owner_id).single();
    const { data: group } = await db.from("conversations").insert({ kind: "group", title: "[test] rls", created_by: ids.luca.owner_id }).select("id").single();
    groupId = group!.id;
    await db.from("conversation_members").insert([ids.luca, ids.marco].map((a) => ({ conversation_id: groupId, user_id: a.owner_id })));
    const { data: task } = await db
      .from("tasks")
      .insert({ owner_id: ids.luca.owner_id, initiator_agent: ids.luca.id, conversation_id: conv!.id, goal: "[test] rls", status: "accepted", group_conversation_id: groupId })
      .select("id")
      .single();
    taskId = task!.id;
    const { data: proposal } = await db
      .from("proposals")
      .insert({ task_id: taskId, content: { title: "t" }, status: "accepted", group_conversation_id: groupId })
      .select("id")
      .single();
    proposalId = proposal!.id;
    const { data: step } = await db.from("plan_steps").insert({ task_id: taskId, position: 0, type: "rsvp", status: "done" }).select("id").single();
    stepId = step!.id;
    await db.from("step_responses").insert({ step_id: stepId, agent_id: ids.luca.id, value: { response: "in" } });
  });

  afterAll(async () => {
    await db.from("tasks").delete().eq("id", taskId);
    await db.from("conversations").delete().eq("id", groupId);
  });

  it("group members can see the plan and everyone's answers (not only the organiser)", async () => {
    const marco = await signIn("marco");
    const { data: proposals } = await marco.from("proposals").select("id").eq("id", proposalId);
    const { data: steps } = await marco.from("plan_steps").select("id").eq("task_id", taskId);
    const { data: responses } = await marco.from("step_responses").select("value").eq("step_id", stepId);
    expect(proposals).toHaveLength(1);
    expect(steps).toHaveLength(1);
    expect(responses).toEqual([{ value: { response: "in" } }]);
  });

  it("what participants told the organiser (availability, food, budget, answers, tips) is not readable by the group", async () => {
    const { updateStep, ensureSteps, PRIVATE_RESULT_MARK } = await import("@/lib/plans/steps");
    const secret = "Only free after 9pm; tight budget this month; needs step-free access";
    // One step of each kind whose result is what people told the organiser, written the way the engine writes it.
    const kinds = ["collect", "question", "ask_around"] as const;
    const results = {
      collect: { replies: [{ handle: "paul", availability: secret, food: "vegan", budget: secret, practical: secret }] },
      question: { answers: { paul: { status: "answered", answer: secret } }, posted: [] },
      ask_around: { tips: [{ handle: "paul", answer: secret, by: "human" }], posted: [], summarised: false },
    };
    const made: string[] = [];
    for (const [i, type] of kinds.entries()) {
      const { data: step } = await db.from("plan_steps").insert({ task_id: taskId, position: 10 + i, type, status: "pending" }).select("id").single();
      made.push(step!.id);
      await updateStep(step!.id, { status: "done", result: results[type] });
    }

    // Marco is in the group (and is not Paul's contact for this purpose): he can see the steps exist, not what was said.
    const marco = await signIn("marco");
    const { data: steps } = await marco.from("plan_steps").select("id, type, status, result").in("id", made);
    expect(steps).toHaveLength(3);
    expect(steps!.every((s) => s.status === "done")).toBe(true);
    expect(steps!.map((s) => s.result)).toEqual([PRIVATE_RESULT_MARK, PRIVATE_RESULT_MARK, PRIVATE_RESULT_MARK]);
    expect(JSON.stringify(steps)).not.toContain("budget");
    // The table that holds it answers nothing to anyone signed in: not a group member, not even the organiser.
    for (const who of ["marco", "luca", "paul"]) {
      const client = await signIn(who);
      const { data: rows } = await client.from("plan_step_private").select("result");
      expect(rows ?? [], who).toEqual([]);
    }
    // Nothing of it in the rows the database itself shows group members.
    const { data: raw } = await db.from("plan_steps").select("result").in("id", made);
    expect(JSON.stringify(raw)).not.toContain(secret);

    // The server still has it, for the organiser's plan (the proposal is built from these replies).
    const { data: task } = await db.from("tasks").select("*").eq("id", taskId).single();
    const full = (await ensureSteps(task!)).filter((s) => made.includes(s.id));
    expect(full.map((s) => s.result)).toEqual(kinds.map((k) => results[k]));

    // If the step can't be looked up, nothing is written anywhere: the result never falls back to the shared row.
    const missing = "00000000-0000-4000-8000-000000000000";
    await expect(updateStep(missing, { status: "done", result: results.collect })).rejects.toThrow("Couldn't save the step's result");
    const { data: stray } = await db.from("plan_steps").select("id").eq("id", missing);
    expect(stray).toEqual([]);

    // A step for the group (who's in) is untouched: its result stays where members read it.
    const { data: rsvp } = await marco.from("plan_steps").select("result").eq("id", stepId).single();
    expect(rsvp!.result).toBeNull();
    await updateStep(stepId, { result: { open: true } });
    const { data: after } = await marco.from("plan_steps").select("result").eq("id", stepId).single();
    expect(after!.result).toEqual({ open: true });
  });

  it("people outside the group see neither", async () => {
    const paul = await signIn("paul");
    const { data: proposals } = await paul.from("proposals").select("id").eq("id", proposalId);
    const { data: steps } = await paul.from("plan_steps").select("id").eq("task_id", taskId);
    const { data: responses } = await paul.from("step_responses").select("value").eq("step_id", stepId);
    expect([proposals, steps, responses]).toEqual([[], [], []]);
  });
});

describe.skipIf(!up)("unread counters (live)", () => {
  it("count others' messages since last read; not your own, not event lines; only your chats", async () => {
    const db = admin();
    const ids = await agentIds();
    const { data: conv } = await db.from("conversations").insert({ kind: "group", title: "[test] unread", created_by: ids.luca.owner_id }).select("id").single();
    try {
      const past = new Date(Date.now() - 60_000).toISOString();
      await db.from("conversation_members").insert([
        { conversation_id: conv!.id, user_id: ids.luca.owner_id, last_read_at: past },
        { conversation_id: conv!.id, user_id: ids.marco.owner_id, last_read_at: past },
      ]);
      await db.from("messages").insert([
        { conversation_id: conv!.id, sender_user_id: ids.marco.owner_id, is_ai_generated: false, content: "hi" },
        { conversation_id: conv!.id, sender_user_id: ids.marco.owner_id, is_ai_generated: false, content: "there?" },
        { conversation_id: conv!.id, sender_user_id: ids.luca.owner_id, is_ai_generated: false, content: "yes" },
        { conversation_id: conv!.id, sender_agent_id: ids.luca.id, is_ai_generated: true, content: "agent note" },
        { conversation_id: conv!.id, is_ai_generated: false, content: "Luca created the group." },
      ]);
      const signIn = async (handle: string) => {
        const c = createClient(URL!, ANON!, { auth: { persistSession: false } });
        await c.auth.signInWithPassword({ email: `${handle}@agentme.test`, password: "password123" });
        return c;
      };
      const countFor = async (handle: string) => {
        const { data } = await (await signIn(handle)).rpc("unread_counts");
        return Number((data ?? []).find((r: { conversation_id: string }) => r.conversation_id === conv!.id)?.unread ?? 0);
      };
      expect(await countFor("luca")).toBe(3); // Marco x2 + the agent's message
      expect(await countFor("marco")).toBe(2); // Luca's message + Luca's agent; never his own
      expect(await countFor("paul")).toBe(0); // not a member: nothing visible

      // Marking read uses the database clock and only ever touches the caller's own row.
      await (await signIn("marco")).rpc("mark_conversation_read", { p_conversation: conv!.id });
      expect(await countFor("luca")).toBe(3);
      expect(await countFor("marco")).toBe(0);
      await (await signIn("luca")).rpc("mark_conversation_read", { p_conversation: conv!.id });
      expect(await countFor("luca")).toBe(0);
    } finally {
      await db.from("conversations").delete().eq("id", conv!.id);
    }
  });
});
