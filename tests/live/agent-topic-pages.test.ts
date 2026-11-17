import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, dbUp, SUPABASE_URL } from "./env";
import { planBusinessFixture } from "../fixtures/plan-business";
import { agentTopicsFixture } from "../fixtures/agent-topics";
import { TopicPage } from "@/lib/agents/topic-types";
import type { Database } from "@/lib/database.types";

describe.skipIf(!dbUp)("paginated My Agent topics", () => {
  let f: Awaited<ReturnType<typeof planBusinessFixture>>; let fixture: Awaited<ReturnType<typeof agentTopicsFixture>>;
  let owner: ReturnType<typeof createClient<Database>>; let stranger: typeof owner;
  const asOf = new Date().toISOString();
  beforeAll(async () => {
    f = await planBusinessFixture(); fixture = await agentTopicsFixture(f);
    owner = createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } }); stranger = createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    for (const [client, person] of [[owner, f.luca], [stranger, f.marco]] as const) { const result = await client.auth.signInWithPassword({ email: person.email, password: f.password }); if (result.error) throw result.error; }
  });
  afterAll(async () => { await f?.cleanup(); });
  async function page(group = "recent", extra = {}) { const result = await owner.rpc("my_agent_topic_page", { p_conversation: f.myAgent, p_group: group, p_as_of: asOf, ...extra }); if (result.error) throw result.error; return TopicPage.parse(result.data); }
  it("loads independent sections ten at a time, with current status and accurate unread counts", async () => {
    const recent = await page(); expect(recent.items).toHaveLength(10); expect(recent.hasMore).toBe(true); expect(recent.counts).toEqual({ recent: 25, progress: 23, needs: 2, older: 13 });
    expect(recent.items[0]).toMatchObject({ title: "Recent topic 01", unread: 1, preview: "Update for Recent topic 01" });
    const progress = await page("progress"); expect(progress.items).toHaveLength(10); expect(progress.items.every((row) => row.task_status === "waiting")).toBe(true);
    expect((await page("needs")).items).toHaveLength(2); expect((await page("older")).items).toHaveLength(10);
    const end = recent.items.at(-1)!; const second = await page("recent", { p_before: end.last_activity_at, p_id: end.id }); expect(second.items).toHaveLength(10);
    const last = second.items.at(-1)!; const third = await page("recent", { p_before: last.last_activity_at, p_id: last.id }); expect(third.items).toHaveLength(5); expect(third.hasMore).toBe(false);
    expect(new Set([...recent.items, ...second.items, ...third.items].map((row) => row.id)).size).toBe(25);
  });
  it("searches older topics and treats wildcard characters literally", async () => {
    const history = await page("search", { p_query: "history TOPIC 13" }); expect(history.items).toHaveLength(1); expect(history.items[0].topic_group).toBe("older");
    expect((await page("search", { p_query: "%" })).items).toEqual([]);
    expect((await owner.rpc("my_agent_topic_page", { p_conversation: f.myAgent, p_before: asOf })).error).toBeTruthy();
    expect((await owner.rpc("my_agent_topic_page", { p_conversation: f.myAgent, p_query: "x".repeat(81) })).error).toBeTruthy();
  });
  it("does not expose another user's topics, a shared chat, or anonymous access", async () => {
    expect((await stranger.rpc("my_agent_topic_page", { p_conversation: f.myAgent })).error).toBeTruthy();
    expect((await owner.rpc("my_agent_topic_page", { p_conversation: f.group })).error).toBeTruthy();
    const anon = createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } }); expect((await anon.rpc("my_agent_topic_page", { p_conversation: f.myAgent })).error).toBeTruthy();
  });
  it("reclassifies a completed request and clears unread only when its message is viewed", async () => {
    const topic = (await page("progress")).items[0]; const task = fixture.tasks.find((row) => row.goal === topic.title)!;
    expect((await f.db.from("tasks").update({ status: "completed" }).eq("id", task.id)).error).toBeNull();
    const changed = await page("search", { p_query: topic.title }); expect(changed.items[0]).toMatchObject({ topic_group: "recent", task_status: "completed", unread: 1 });
    const message = await f.db.from("messages").select("id").eq("thread_id", topic.id).single();
    expect((await owner.rpc("acknowledge_messages", { p_ids: [message.data!.id], p_seen: true })).error).toBeNull();
    expect((await page("search", { p_query: topic.title })).items[0].unread).toBe(0);
  });
});
