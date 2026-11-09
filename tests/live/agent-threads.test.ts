/**
 * My Agent threads: every message posted into My Agent is filed into a thread
 * (by the database), each thread has its own unread count, and nobody else can
 * see them. Throwaway users, deleted afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, SUPABASE_URL, admin, dbUp } from "./env";
import type { Database } from "@/lib/database.types";

const run = Math.random().toString(36).slice(2, 7);
const PASSWORD = "thread-test-password";
const people = {} as Record<"owner" | "other", { userId: string; email: string; agentId: string; handle: string }>;
let myAgent = "";
let groupId = "";

const lib = async () => ({
  chat: await import("@/lib/data/chat"),
  threads: await import("@/lib/agents/threads"),
  ctx: await import("@/lib/agents/thread-context"),
});
const signedIn = async (email: string) => {
  const c = createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return c;
};
const threadOf = async (messageId: string) => (await admin().from("messages").select("thread_id").eq("id", messageId).single()).data!.thread_id;
const newTask = async (event: string) =>
  (
    await admin()
      .from("tasks")
      .insert({
        owner_id: people.owner.userId,
        initiator_agent: people.owner.agentId,
        conversation_id: myAgent,
        goal: `${event} with @marco`,
        parsed: { kind: "rsvp", event, window: "Friday", participants: ["marco"], categories: [] },
        status: "waiting",
      })
      .select("id")
      .single()
  ).data!.id;

describe.skipIf(!dbUp)("My Agent threads (live)", () => {
  beforeAll(async () => {
    const db = admin();
    for (const key of ["owner", "other"] as const) {
      const handle = `tt${run}_${key}`.slice(0, 20);
      const email = `${handle}@threads.test`;
      const { data: created, error } = await db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      if (error) throw error;
      const { data: agent } = await db.from("agents").insert({ owner_id: created.user.id, handle, display_name: `Test ${key}`, avatar: "🦊" }).select("id").single();
      people[key] = { userId: created.user.id, email, agentId: agent!.id, handle };
    }
    const { chat } = await lib();
    myAgent = (await chat.getOrCreateMyAgentConversation(people.owner.userId)).id;
    groupId = (await chat.createConversation({ kind: "group", title: "Threads test", createdBy: people.owner.userId, memberIds: [people.other.userId] })).id;
  });

  afterAll(async () => {
    const db = admin();
    const ids = Object.values(people).map((p) => p.userId);
    await db.from("conversations").delete().in("created_by", ids);
    for (const id of ids) await db.auth.admin.deleteUser(id);
  });

  it("a request typed in a thread stays there, and the plan it starts names the thread", async () => {
    const { chat, threads, ctx } = await lib();
    const thread = await threads.resolveThread({ userId: people.owner.userId, conversationId: myAgent, text: "organise pizza on friday with @marco" });
    expect((await admin().from("agent_threads").select("title").eq("id", thread).single()).data?.title).toBe("Organise pizza on friday with @marco");
    const task = await newTask("Pizza");
    await ctx.withThread({ conversationId: myAgent, threadId: thread }, async () => {
      const typed = await chat.postMessage({ conversationId: myAgent, from: "human", userId: people.owner.userId, content: "organise pizza on friday with @marco" });
      const reply = await chat.postMessage({ conversationId: myAgent, from: "agent", agentId: people.owner.agentId, content: "Approve?", metadata: { kind: "task_card", task_id: task } });
      expect(await threadOf(typed.id)).toBe(thread);
      expect(await threadOf(reply.id)).toBe(thread);
    });
    expect((await admin().from("agent_threads").select("title").eq("id", thread).single()).data?.title).toBe("Pizza with @marco · Friday");
    // Later, from the background (no thread known): the plan's messages still find their thread.
    const later = await chat.postMessage({ conversationId: myAgent, from: "agent", agentId: people.owner.agentId, content: "Marco is in", metadata: { kind: "info", task_id: task } });
    expect(await threadOf(later.id)).toBe(thread);
  });

  it("a plan started elsewhere gets its own thread; notes go to 'From your agent'", async () => {
    const { chat } = await lib();
    const task = await newTask("Drinks");
    const card = await chat.postMessage({ conversationId: myAgent, from: "agent", agentId: people.owner.agentId, content: "Approve?", metadata: { kind: "task_card", task_id: task } });
    const { data: own } = await admin().from("agent_threads").select("title, kind").eq("id", (await threadOf(card.id))!).single();
    expect(own).toEqual({ title: "Drinks with @marco · Friday", kind: "request" });

    const note1 = await chat.postMessage({ conversationId: myAgent, from: "agent", agentId: people.owner.agentId, content: "Marco asked you something", metadata: { kind: "request_note" } });
    const note2 = await chat.postMessage({ conversationId: myAgent, from: "agent", agentId: people.owner.agentId, content: "Another note" });
    const updates = await threadOf(note1.id);
    expect(await threadOf(note2.id)).toBe(updates);
    expect((await admin().from("agent_threads").select("kind, title").eq("id", updates!).single()).data).toEqual({ kind: "updates", title: "From your agent" });
  });

  it("threads only exist in My Agent; a thread from another chat or person is ignored", async () => {
    const { chat, ctx } = await lib();
    const { data: someThread } = await admin().from("agent_threads").select("id").eq("conversation_id", myAgent).limit(1).single();
    const inGroup = await chat.postMessage({ conversationId: groupId, from: "human", userId: people.owner.userId, content: "hi", threadId: someThread!.id });
    expect(await threadOf(inGroup.id)).toBeNull();
    // The context only applies to the My Agent it was set for.
    await ctx.withThread({ conversationId: myAgent, threadId: someThread!.id }, async () => {
      const elsewhere = await chat.postMessage({ conversationId: groupId, from: "human", userId: people.owner.userId, content: "hello" });
      expect(await threadOf(elsewhere.id)).toBeNull();
    });
    // Someone else's thread can't be used.
    const { threads } = await lib();
    const otherMyAgent = (await chat.getOrCreateMyAgentConversation(people.other.userId)).id;
    const theirs = await threads.resolveThread({ userId: people.other.userId, conversationId: otherMyAgent, threadId: someThread!.id, text: "mine" });
    expect(theirs).not.toBe(someThread!.id);
  });

  it("a note about someone else's plan is filed in your own My Agent, never in their thread", async () => {
    const { chat } = await lib();
    const task = await newTask("Picnic"); // the owner's plan
    const otherMyAgent = (await chat.getOrCreateMyAgentConversation(people.other.userId)).id;
    const note = await chat.postMessage({ conversationId: otherMyAgent, from: "agent", agentId: people.other.agentId, content: "I sent your answer", metadata: { kind: "info", task_id: task } });
    const { data: thread } = await admin().from("agent_threads").select("conversation_id, kind").eq("id", (await threadOf(note.id))!).single();
    expect(thread).toEqual({ conversation_id: otherMyAgent, kind: "updates" });
  });

  it("each thread has its own unread count; My Agent's badge counts threads, not messages", async () => {
    const owner = await signedIn(people.owner.email);
    const { data: list } = await owner.rpc("my_agent_threads");
    const unread = (list ?? []).filter((t) => Number(t.unread) > 0);
    expect(unread.length).toBeGreaterThanOrEqual(2);
    const updates = (list ?? []).find((t) => t.kind === "updates")!;
    expect(Number(updates.unread)).toBe(2); // two notes
    const { data: counts } = await owner.rpc("unread_counts");
    expect(Number(counts?.find((c) => c.conversation_id === myAgent)?.unread)).toBe(unread.length);

    await owner.rpc("mark_thread_read", { p_thread: updates.id });
    const { data: after } = await owner.rpc("my_agent_threads");
    expect(Number(after?.find((t) => t.id === updates.id)?.unread)).toBe(0);
    const { data: countsAfter } = await owner.rpc("unread_counts");
    expect(Number(countsAfter?.find((c) => c.conversation_id === myAgent)?.unread ?? 0)).toBe(unread.length - 1);
  });

  it("nobody else can see or mark your threads", async () => {
    const other = await signedIn(people.other.email);
    const { data: seen } = await other.from("agent_threads").select("id").eq("conversation_id", myAgent);
    expect(seen).toEqual([]);
    const { data: someThread } = await admin().from("agent_threads").select("id, last_read_at").eq("conversation_id", myAgent).limit(1).single();
    await other.rpc("mark_thread_read", { p_thread: someThread!.id });
    expect((await admin().from("agent_threads").select("last_read_at").eq("id", someThread!.id).single()).data?.last_read_at).toBe(someThread!.last_read_at);
    const { error } = await other.from("agent_threads").update({ title: "hacked" }).eq("id", someThread!.id);
    expect((await admin().from("agent_threads").select("title").eq("id", someThread!.id).single()).data?.title).not.toBe("hacked");
    expect(error === null || Boolean(error)).toBe(true);
  });

  it("titles from typed text are short and tidy", async () => {
    const { threads } = await lib();
    expect(threads.titleFromText("@agent  summarise this please")).toBe("Summarise this please");
    expect(threads.titleFromText("x".repeat(100))).toHaveLength(58);
    expect(threads.titleFromText("   ")).toBe("New request");
  });
});
