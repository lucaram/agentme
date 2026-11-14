import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, SUPABASE_URL, dbUp } from "./env";
import { planBusinessFixture } from "../fixtures/plan-business";
import { currentChatActions } from "@/lib/business/current-actions";
import { waysOf } from "@/lib/business/booking";
import type { Json } from "@/lib/database.types";

describe.skipIf(!dbUp)("current published customer actions", () => {
  let f: Awaited<ReturnType<typeof planBusinessFixture>>;
  beforeAll(async () => {
    f = await planBusinessFixture();
    f.business.agent.business_info = { ...f.business.agent.business_info as object, ways: [{ kind: "book", value: `https://${f.business.agent.handle}.example/book` }, { kind: "call", value: "020 7946 0000" }] };
    await f.db.from("agents").update({ business_info: f.business.agent.business_info }).eq("id", f.business.agent.id);
  });
  afterAll(async () => { await f?.cleanup(); });
  const current = async () => (await currentChatActions([f.business.agent.id])).actions.get(f.business.agent.id)!;

  it("updates existing cards from the current list and never restores deleted methods from older public/private sources", async () => {
    const original = f.business.agent.business_info as Record<string, Json>;
    const { error } = await f.db.from("business_sites").insert({ agent_id: f.business.agent.id, url: "https://sole.example/", domain: "sole.example", live_at: new Date().toISOString(), learned: { phone: "020 1111 1111", email: "website@sole.example" } });
    if (error) throw error;
    await f.db.from("agents").update({ business_info: { ...original, customers: "Private email: secret@sole.example", ways: [{ kind: "book", value: "https://sole.example/new-booking" }, { kind: "call", value: "020 2222 2222" }] } }).eq("id", f.business.agent.id);
    expect((await current()).reservation).toEqual([{ kind: "book", value: "https://sole.example/new-booking" }, { kind: "call", value: "020 2222 2222" }]);
    await f.db.from("agents").update({ business_info: { ...original, ways: [{ kind: "book", value: "https://sole.example/book" }] } }).eq("id", f.business.agent.id);
    expect((await current()).all).toEqual([{ kind: "book", value: "https://sole.example/book" }]);
    await f.db.from("agents").update({ business_info: { ...original, ways: [] } }).eq("id", f.business.agent.id);
    expect(await current()).toEqual({ all: [], reservation: [] });
    await f.db.from("agents").update({ business_info: original }).eq("id", f.business.agent.id);
  });

  it("links unambiguous old replies without rewriting their text, hides unresolved/ambiguous snapshots and keeps the identity for later edits", async () => {
    const ways = waysOf(f.business.agent.business_info);
    const { data: message, error } = await f.db.from("messages").insert({ conversation_id: f.myAgent, sender_agent_id: f.luca.agent.id, is_ai_generated: true, content: "Original historical answer", metadata: { booking_ways: ways } }).select("id,metadata").single();
    if (error) throw error;
    const data = await currentChatActions([], [{ messageId: message!.id, ways, metadata: message!.metadata }]);
    expect(data.legacyIdentities.get(message!.id)).toBe(f.business.agent.id);
    const { data: saved } = await f.db.from("messages").select("content,metadata").eq("id", message!.id).single();
    expect(saved!.content).toBe("Original historical answer");
    expect(saved!.metadata).toMatchObject({ booking_ways: ways, booking_business_id: f.business.agent.id });
    const unresolved = await currentChatActions([], [{ messageId: "unknown", ways: [{ kind: "call", value: "020 9999 9999" }] }]);
    expect(unresolved.legacyIdentities.size).toBe(0);
    expect(unresolved.actions.size).toBe(0);
    await f.db.from("agents").update({ type: "business", business_info: f.business.agent.business_info }).eq("id", f.paul.agent.id);
    expect((await currentChatActions([], [{ messageId: "ambiguous", ways }])).legacyIdentities.size).toBe(0);
    await f.db.from("agents").update({ type: "personal", business_info: {} }).eq("id", f.paul.agent.id);
  });

  it("publishes only change signals; customers cannot read private business data or write revision rows", async () => {
    const revision = async () => (await f.db.from("business_action_versions").select("*").eq("agent_id", f.business.agent.id).single()).data!;
    const before = await revision();
    await f.db.from("agents").update({ business_info: { ...f.business.agent.business_info as object, customers: "Do not stream this private note" } }).eq("id", f.business.agent.id);
    expect((await revision()).version).toBeGreaterThan(before.version);
    const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await client.auth.signInWithPassword({ email: f.marco.email, password: f.password });
    const { data: rows, error } = await client.from("business_action_versions").select("*").eq("agent_id", f.business.agent.id);
    expect(error).toBeNull();
    expect(Object.keys(rows![0]).sort()).toEqual(["agent_id", "updated_at", "version"]);
    expect((await client.from("agents").select("business_info").eq("id", f.business.agent.id)).error).toBeTruthy();
    expect((await client.from("business_action_versions").update({ version: 99999 }).eq("agent_id", f.business.agent.id)).error).toBeTruthy();
  });
});
