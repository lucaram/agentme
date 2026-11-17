import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, dbUp, SUPABASE_URL } from "./env";
import { planBusinessFixture } from "../fixtures/plan-business";
import { MentionPage, MentionState } from "@/lib/chat/mentions";
import type { Database } from "@/lib/database.types";

describe.skipIf(!dbUp)("private unread mention inbox", () => {
  let f: Awaited<ReturnType<typeof planBusinessFixture>>;
  const clients: Record<string, ReturnType<typeof createClient<Database>>> = {};
  let ids: string[];
  beforeAll(async () => {
    f = await planBusinessFixture();
    for (const [name, person] of Object.entries({ marco: f.marco, business: f.business })) {
      const client = createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
      const result = await client.auth.signInWithPassword({ email: person.email, password: f.password }); if (result.error) throw result.error;
      clients[name] = client;
    }
    const result = await f.db.from("messages").insert(Array.from({ length: 55 }, (_, i) => ({ conversation_id: f.group, sender_user_id: f.luca.userId, content: `@${f.marco.agent.handle} question ${i}`, is_ai_generated: false }))).select("id");
    if (result.error) throw result.error; ids = result.data!.map((m) => m.id);
  });
  afterAll(async () => { await f?.cleanup(); });
  async function page(args = {}) { const result = await clients.marco.rpc("unread_mention_page", args); if (result.error) throw result.error; return MentionPage.parse(result.data); }
  it("paginates stable snapshots without marking them read or exposing another person's messages", async () => {
    const first = await page(); expect(first.items).toHaveLength(50); expect(first.hasMore).toBe(true);
    expect(first.items[0]).toMatchObject({ sender: "Luca", conversation_id: f.group });
    expect(first.items[0].preview).toContain(`@${f.marco.agent.handle} question`);
    expect((await f.db.from("mention_alerts").select("seen_at").in("message_id", ids)).data!.every((a) => a.seen_at === null)).toBe(true);
    expect((await clients.business.rpc("unread_mention_page")).data).toEqual({ items: [], hasMore: false });
    expect((await clients.marco.rpc("unread_mention_page", { p_before: first.items[0].created_at })).error).toBeTruthy();
    // Removing a newer item cannot skip an older one, unlike offset pagination.
    expect((await clients.marco.rpc("acknowledge_messages", { p_ids: [first.items[0].message_id], p_seen: true })).error).toBeNull();
    const cursor = first.items.at(-1)!; const next = await page({ p_before: cursor.created_at, p_message: cursor.message_id });
    expect(next.items).toHaveLength(5); expect(next.hasMore).toBe(false);
    expect(new Set([...first.items, ...next.items].map((a) => a.message_id)).size).toBe(55);
  });
  it("reconciles only the caller's unread IDs and drains claim batches without losing arrivals", async () => {
    const first = await clients.marco.rpc("mention_state", { p_claim: true, p_known: ids }); expect(first.error).toBeNull();
    let state = MentionState.parse(first.data); expect(state.total).toBe(54); expect(state.active_ids).toHaveLength(54);
    const claimed = [...state.alerts];
    for (let i = 0; state.more_alerts && i < 4; i++) {
      const result = await clients.marco.rpc("mention_state", { p_claim: true, p_known: ids }); expect(result.error).toBeNull(); state = MentionState.parse(result.data); claimed.push(...state.alerts);
    }
    expect(state.more_alerts).toBe(false); expect(new Set(claimed.map((a) => a.message_id)).size).toBe(54);
    const other = await clients.business.rpc("mention_state", { p_claim: false, p_known: ids }); expect(other.error).toBeNull();
    expect(MentionState.parse(other.data)).toMatchObject({ total: 0, active_ids: [], alerts: [] });
    expect((await clients.marco.rpc("mention_state", { p_claim: false, p_known: Array.from({ length: 1001 }, () => ids[0]) })).error).toBeTruthy();
  });
  it("excludes removed messages and revokes access as soon as membership ends", async () => {
    const first = await page();
    expect((await f.db.from("messages").update({ removed_at: new Date().toISOString() }).eq("id", first.items[0].message_id)).error).toBeNull();
    expect((await page()).items.some((a) => a.message_id === first.items[0].message_id)).toBe(false);
    expect((await f.db.from("conversation_members").delete().eq("conversation_id", f.group).eq("user_id", f.marco.userId)).error).toBeNull();
    expect(await page()).toEqual({ items: [], hasMore: false });
    const result = await clients.marco.rpc("mention_state", { p_claim: false, p_known: ids }); expect(result.error).toBeNull(); expect(MentionState.parse(result.data)).toMatchObject({ total: 0, active_ids: [] });
  });
});
