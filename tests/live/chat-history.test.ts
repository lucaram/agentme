import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, dbUp, SUPABASE_URL } from "./env";
import { planBusinessFixture } from "../fixtures/plan-business";
import { GET } from "@/app/api/chats/[id]/history/route";
import type { Database } from "@/lib/database.types";
import type { HistoryBundle, HistoryPage, HistoryRequest } from "@/lib/chat/history-types";

const session = vi.hoisted(() => ({ user: null as { id: string } | null, client: null as unknown }));
vi.mock("@/lib/auth", () => ({ getUser: async () => session.user }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));

describe.skipIf(!dbUp)("bounded, RLS-protected chat history", () => {
  let f: Awaited<ReturnType<typeof planBusinessFixture>>;
  const clients: Record<string, ReturnType<typeof createClient<Database>>> = {};
  let historical: string[];
  beforeAll(async () => {
    f = await planBusinessFixture();
    for (const [key, person] of Object.entries({ luca: f.luca, marco: f.marco, business: f.business })) {
      const client = createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
      const { error } = await client.auth.signInWithPassword({ email: person.email, password: f.password }); if (error) throw error; clients[key] = client;
    }
    historical = Array.from({ length: 2105 }, () => crypto.randomUUID()).sort();
    const { error } = await f.db.from("messages").insert(historical.map((id) => ({ id, conversation_id: f.group, sender_user_id: f.luca.userId, is_ai_generated: false, content: `History ${id}`, created_at: "2026-11-14T09:00:00Z" }))); if (error) throw error;
  });
  afterAll(async () => { await f?.cleanup(); });
  async function page(request: HistoryRequest, person = "luca", conv = f.group, thread?: string) {
    const { data, error } = await clients[person].rpc("chat_history_page", { p_conversation: conv, p_thread: thread ?? null, p_mode: request.mode, p_anchor: request.anchor ?? null, p_ids: request.ids ?? [] });
    expect(error).toBeNull(); return data as unknown as HistoryPage;
  }
  async function route(query = "", person: "luca" | "marco" | "business" | null = "luca", conv = f.group) {
    session.user = person ? { id: f[person].userId } : null; session.client = person ? clients[person] : null;
    return GET(new Request(`http://localhost:3000/api/chats/${conv}/history${query}`), { params: Promise.resolve({ id: conv }) });
  }
  async function incoming(content: string, extra: Partial<Database["public"]["Tables"]["messages"]["Insert"]> = {}) {
    const { data, error } = await f.db.from("messages").insert({ conversation_id: f.group, sender_user_id: f.marco.userId, is_ai_generated: false, content, ...extra }).select("id").single(); if (error) throw error; return data!.id;
  }
  it("loads fifty at a time and traverses beyond 2,000 messages without gaps or duplicate equal timestamps", async () => {
    let chunk = await page({ mode: "latest" }); const ids: string[] = [];
    expect(chunk.messages).toHaveLength(50); expect(chunk.hasAfter).toBe(false); expect(chunk.firstUnread).toBeNull();
    while (chunk.messages.length) {
      expect(chunk.messages.length).toBeLessThanOrEqual(50); ids.unshift(...chunk.messages.map((m) => m.id));
      if (!chunk.hasBefore) break;
      chunk = await page({ mode: "before", anchor: chunk.messages[0].id });
    }
    expect(ids).toEqual(historical); expect(new Set(ids).size).toBe(historical.length);
    const after = await page({ mode: "after", anchor: historical[49] }); expect(after.messages.map((m) => m.id)).toEqual(historical.slice(50, 100));
  });
  it("opens around the first genuinely unread message, respecting delivery/viewing and per-message gaps", async () => {
    const first = await incoming("First unread"); const second = await incoming("Second unread");
    await clients.luca.rpc("acknowledge_messages", { p_ids: [second], p_seen: true });
    let chunk = await page({ mode: "initial" }); expect(chunk.firstUnread).toBe(first); expect(chunk.unreadIds).toContain(first); expect(chunk.unreadIds).not.toContain(second);
    await clients.luca.rpc("acknowledge_messages", { p_ids: [first], p_seen: false }); expect((await page({ mode: "initial" })).firstUnread).toBe(first);
    await clients.luca.rpc("acknowledge_messages", { p_ids: [first], p_seen: true }); chunk = await page({ mode: "initial" }); expect(chunk.firstUnread).toBeNull(); expect(chunk.hasAfter).toBe(false);
  });
  it("never exposes private messages, foreign conversation anchors, or history to outsiders", async () => {
    const privateId = await incoming("Marco's private command", { visible_to: f.marco.userId });
    expect((await page({ mode: "latest" })).messages.some((m) => m.id === privateId)).toBe(false);
    expect((await clients.luca.rpc("chat_history_page", { p_conversation: f.group, p_mode: "around", p_anchor: privateId })).error).toBeTruthy();
    expect((await page({ mode: "refresh", ids: [privateId] })).messages).toEqual([]);
    expect((await clients.business.rpc("chat_history_page", { p_conversation: f.group })).error).toBeTruthy();
    expect((await clients.luca.rpc("chat_history_page", { p_conversation: f.direct, p_mode: "around", p_anchor: historical[0] })).error).toBeTruthy();
    const anon = createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } }); expect((await anon.rpc("chat_history_page", { p_conversation: f.group })).error).toBeTruthy();
    expect((await clients.luca.rpc("chat_history_page", { p_conversation: f.group, p_mode: "refresh", p_ids: Array(51).fill(historical[0]) })).error).toBeTruthy();
  });
  it("scopes every direction and unread lookup to the correct My Agent request", async () => {
    const { data: threads } = await f.db.from("agent_threads").insert(["A", "B"].map((title) => ({ owner_id: f.luca.userId, conversation_id: f.myAgent, title }))).select("id");
    const a = await incoming("Answer in request A", { conversation_id: f.myAgent, thread_id: threads![0].id, sender_user_id: null, sender_agent_id: f.luca.agent.id, is_ai_generated: true });
    const b = await incoming("Answer in request B", { conversation_id: f.myAgent, thread_id: threads![1].id, sender_user_id: null, sender_agent_id: f.luca.agent.id, is_ai_generated: true });
    const requestA = await page({ mode: "initial" }, "luca", f.myAgent, threads![0].id); expect(requestA.firstUnread).toBe(a); expect(requestA.messages.map((m) => m.id)).toEqual([a]);
    expect((await clients.luca.rpc("chat_history_page", { p_conversation: f.myAgent, p_thread: threads![0].id, p_mode: "around", p_anchor: b })).error).toBeTruthy();
    expect((await clients.luca.rpc("chat_history_page", { p_conversation: f.group, p_thread: threads![0].id })).error).toBeTruthy();
    expect((await clients.marco.rpc("chat_history_page", { p_conversation: f.myAgent, p_thread: threads![0].id })).error).toBeTruthy();
  });
  it("validates the read API, uses private no-store responses and includes only authorised related data", async () => {
    expect((await route("", null)).status).toBe(401); expect((await route("?mode=everything")).status).toBe(400); expect((await route("", "business")).status).toBe(404);
    const fact = await f.db.from("agent_facts").insert({ agent_id: f.marco.agent.id, category: "notes", value: "SECRET_OTHER_OWNER", disclosure: "private" }); expect(fact.error).toBeNull();
    const response = await route("?mode=latest"); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    const data: HistoryBundle = await response.json(); expect(data.messages.length).toBeLessThanOrEqual(50); expect(JSON.stringify(data)).not.toContain("SECRET_OTHER_OWNER"); expect(data.facts.every((fact) => fact.agent_id === f.luca.agent.id)).toBe(true);
    expect((await route(`?mode=refresh&${Array(51).fill(`item=${historical[0]}`).join("&")}`)).status).toBe(400);
  });
});
