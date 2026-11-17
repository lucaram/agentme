import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, dbUp, SUPABASE_URL } from "./env";
import { planBusinessFixture } from "../fixtures/plan-business";
import { saveTip, ownerTips } from "@/lib/profile/tips";
import { getTips } from "@/lib/data/agents";
import { respondAsAgent } from "@/lib/agents/respond";
import type { Database } from "@/lib/database.types";

describe.skipIf(!dbUp)("saved tip visibility", () => {
  let f: Awaited<ReturnType<typeof planBusinessFixture>>; let id: string;
  beforeAll(async () => { f = await planBusinessFixture(); });
  afterAll(async () => { await f?.cleanup(); });
  it("defaults new database rows to private and exposes them only to their owner", async () => {
    const inserted = await f.db.from("agent_tips").insert({ agent_id: f.luca.agent.id, topic: "Plumber", tip: "PRIVATE: My trusted plumber" }).select("id,disclosure").single();
    expect(inserted.error).toBeNull(); id = inserted.data!.id; expect(inserted.data!.disclosure).toBe("private");
    expect(await ownerTips({ agentId: f.luca.agent.id, userId: f.luca.userId })).toEqual([{ topic: "Plumber", tip: "PRIVATE: My trusted plumber", disclosure: "private" }]);
    expect(await getTips(f.luca.agent.id)).toEqual([]); expect(await ownerTips({ agentId: f.luca.agent.id, userId: f.marco.userId })).toEqual([]);
    const stranger = createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } }); await stranger.auth.signInWithPassword({ email: f.marco.email, password: f.password });
    expect((await stranger.from("agent_tips").select("tip").eq("id", id)).data).toEqual([]);
  });
  it("requires ownership and an explicit boolean to save content or sharing permission", async () => {
    expect(await saveTip({ agentId: f.luca.agent.id, userId: f.marco.userId }, { id, topic: "Plumber", tip: "stolen", share: true })).toHaveProperty("error");
    expect(await saveTip({ agentId: f.luca.agent.id, userId: f.luca.userId }, { id, topic: "Plumber", tip: "invalid", share: "true" })).toHaveProperty("error");
    expect(await saveTip({ agentId: f.marco.agent.id, userId: f.marco.userId }, { id, topic: "Plumber", tip: "stolen", share: true })).toHaveProperty("error");
    expect((await f.db.from("agent_tips").select("tip,disclosure").eq("id", id).single()).data).toEqual({ tip: "PRIVATE: My trusted plumber", disclosure: "private" });
  });
  it("shares only after opt-in and immediately stops new automated replies after privacy is restored", async () => {
    const owner = { agentId: f.luca.agent.id, userId: f.luca.userId }; const request = { callerHandle: f.marco.agent.handle, relationship: "accepted" as const, text: "", data: { type: "agentme.ask_around", question: "Can anyone recommend a plumber?" } };
    expect(await saveTip(owner, { id, topic: "Plumber", tip: "Trusted Plumbing Co.", share: true })).toEqual({});
    const shared = await getTips(f.luca.agent.id); expect(shared).toHaveLength(1);
    expect(await respondAsAgent({ ...f.luca.agent, business_info: {} }, request, [], shared)).toMatchObject({ status: "completed", text: "Trusted Plumbing Co." });
    expect(await saveTip(owner, { id, topic: "Plumber", tip: "Trusted Plumbing Co.", share: false })).toEqual({});
    expect(await getTips(f.luca.agent.id)).toEqual([]);
    expect(await respondAsAgent({ ...f.luca.agent, business_info: {} }, request, [], await ownerTips(owner))).toMatchObject({ status: "needs_human", disclosed: [] });
    expect((await ownerTips(owner))[0].tip).toBe("Trusted Plumbing Co.");
  });
});
