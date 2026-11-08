/**
 * "@agent ..." in a group: private to the person who asked (enforced by RLS),
 * reads only what everyone in the chat can see, and plans post into the chat.
 * Needs the local Supabase stack (no A2A calls are made here).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, SUPABASE_URL, admin, agentIds, dbUp } from "./env";

let ids: Awaited<ReturnType<typeof agentIds>>;
let groupId: string;
const tasks: string[] = [];
type AgentRow = Awaited<ReturnType<typeof import("@/lib/data/agents").getAgentById>>;
let luca: NonNullable<AgentRow>;

const signIn = async (handle: string) => {
  const c = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email: `${handle}@agentme.test`, password: "password123" });
  return c;
};
const command = async (text: string) => {
  const { handleAgentCommand } = await import("@/lib/agents/in-chat");
  const { data: conversation } = await admin().from("conversations").select("id, kind, title").eq("id", groupId).single();
  await handleAgentCommand({ userId: ids.luca.owner_id, agent: luca, conversation: conversation!, text });
};
const lastPrivateReply = async () =>
  (await admin().from("messages").select("content, metadata, visible_to, sender_agent_id").eq("conversation_id", groupId).not("visible_to", "is", null).order("created_at", { ascending: false }).limit(1).single()).data!;

describe.skipIf(!dbUp)("@agent in a group chat (live)", () => {
  beforeAll(async () => {
    ids = await agentIds();
    const db = admin();
    luca = (await db.from("agents").select("*").eq("handle", "luca").single()).data!;
    const { data: group } = await db.from("conversations").insert({ kind: "group", title: "[test] agent chat", created_by: ids.luca.owner_id }).select("id").single();
    groupId = group!.id;
    await db.from("conversation_members").insert([ids.luca, ids.marco].map((a) => ({ conversation_id: groupId, user_id: a.owner_id })));
    await db.from("messages").insert([
      { conversation_id: groupId, sender_user_id: ids.marco.owner_id, is_ai_generated: false, content: "ciao, sabato alle 8?" },
      // Marco's own private exchange with HIS agent: Luca's agent must never see it.
      { conversation_id: groupId, sender_user_id: ids.marco.owner_id, is_ai_generated: false, content: "@agent SECRET-NOTE", visible_to: ids.marco.owner_id },
    ]);
  });

  afterAll(async () => {
    // Progress notes go to Luca's own My Agent chat: remove them too.
    if (tasks.length) await admin().from("messages").delete().in("metadata->>task_id", tasks);
    if (tasks.length) await admin().from("tasks").delete().in("id", tasks);
    await admin().from("conversations").delete().eq("id", groupId);
  });

  it("summarise: private to Luca, built only from what everyone can see", async () => {
    await command("@agent summarise");
    const reply = await lastPrivateReply();
    expect(reply).toMatchObject({ visible_to: ids.luca.owner_id, sender_agent_id: ids.luca.id });
    expect(reply.content).toContain("ciao, sabato alle 8?");
    expect(reply.content).not.toContain("SECRET-NOTE");

    // RLS: Marco sees neither Luca's command nor the answer; Luca does.
    const asMarco = await (await signIn("marco")).from("messages").select("content").eq("conversation_id", groupId);
    const asLuca = await (await signIn("luca")).from("messages").select("content").eq("conversation_id", groupId);
    expect(asMarco.data!.map((m) => m.content)).not.toContain("@agent summarise");
    expect(asMarco.data!.some((m) => m.content.startsWith("📝"))).toBe(false);
    expect(asLuca.data!.map((m) => m.content)).toContain("@agent summarise");
    expect(asLuca.data!.map((m) => m.content)).not.toContain("@agent SECRET-NOTE");
  });

  it("translate: the last message from someone else, privately", async () => {
    await command("@agent translate");
    expect((await lastPrivateReply()).content).toBe("🌐 English: (English) ciao, sabato alle 8?");
  });

  it("draft: a private draft the owner can send as their own message", async () => {
    await command("@agent draft say I'm in but late");
    const reply = await lastPrivateReply();
    expect(reply.metadata).toMatchObject({ kind: "draft", draft: "Sounds good — say I'm in but late" });
  });

  it("a poll from the chat uses its members and is posted into this chat", async () => {
    await command("@agent poll: pizza or sushi?");
    const card = await lastPrivateReply();
    expect(card.metadata).toMatchObject({ kind: "task_card" });
    const taskId = (card.metadata as { task_id: string }).task_id;
    tasks.push(taskId);

    const { approveTask, runTask } = await import("@/lib/coordination/orchestrator");
    expect(await approveTask(taskId, ids.luca.owner_id)).toBe(true);
    await runTask(taskId);
    const { data: task } = await admin().from("tasks").select("group_conversation_id, parsed").eq("id", taskId).single();
    expect(task!.group_conversation_id).toBe(groupId); // no new group
    expect((task!.parsed as { participants: string[] }).participants).toEqual(["marco"]);

    const asMarco = await (await signIn("marco")).from("messages").select("content, metadata").eq("conversation_id", groupId);
    expect(asMarco.data!.some((m) => (m.metadata as { kind?: string }).kind === "poll")).toBe(true);
    expect(asMarco.data!.some((m) => (m.metadata as { kind?: string }).kind === "task_card")).toBe(false); // approval card stays private
  });
});
