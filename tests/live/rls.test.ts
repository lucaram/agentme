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

  beforeAll(async () => {
    const ids = await agentIds();
    const { data: conv } = await db.from("conversations").select("id").eq("kind", "my_agent").eq("created_by", ids.luca.owner_id).single();
    const { data: group } = await db.from("conversations").insert({ kind: "group", title: "[test] rls", created_by: ids.luca.owner_id }).select("id").single();
    groupId = group!.id;
    await db.from("conversation_members").insert([ids.luca, ids.marco].map((a) => ({ conversation_id: groupId, user_id: a.owner_id })));
    const { data: task } = await db
      .from("tasks")
      .insert({ owner_id: ids.luca.owner_id, initiator_agent: ids.luca.id, conversation_id: conv!.id, goal: "[test] rls", status: "accepted" })
      .select("id")
      .single();
    taskId = task!.id;
    const { data: proposal } = await db
      .from("proposals")
      .insert({ task_id: taskId, content: { title: "t" }, status: "accepted", group_conversation_id: groupId })
      .select("id")
      .single();
    proposalId = proposal!.id;
    await db.from("proposal_responses").insert({ proposal_id: proposalId, agent_id: ids.luca.id, response: "accepted" });
  });

  afterAll(async () => {
    await db.from("tasks").delete().eq("id", taskId);
    await db.from("conversations").delete().eq("id", groupId);
  });

  it("group members can see the plan and everyone's answers (not only the organiser)", async () => {
    const marco = await signIn("marco");
    const { data: proposals } = await marco.from("proposals").select("id").eq("id", proposalId);
    const { data: responses } = await marco.from("proposal_responses").select("response").eq("proposal_id", proposalId);
    expect(proposals).toHaveLength(1);
    expect(responses).toEqual([{ response: "accepted" }]);
  });

  it("people outside the group see neither", async () => {
    const paul = await signIn("paul");
    const { data: proposals } = await paul.from("proposals").select("id").eq("id", proposalId);
    const { data: responses } = await paul.from("proposal_responses").select("response").eq("proposal_id", proposalId);
    expect([proposals, responses]).toEqual([[], []]);
  });
});
