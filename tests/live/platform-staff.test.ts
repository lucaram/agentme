import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, dbUp, SUPABASE_URL } from "./env";
import { planBusinessFixture } from "../fixtures/plan-business";
import type { Database } from "@/lib/database.types";

describe.skipIf(!dbUp)("operator-only platform staff management", () => {
  let f: Awaited<ReturnType<typeof planBusinessFixture>>;
  const clients: Record<string, ReturnType<typeof createClient<Database>>> = {};
  beforeAll(async () => {
    f = await planBusinessFixture();
    for (const [name, person] of Object.entries({ luca: f.luca, marco: f.marco, paul: f.paul, business: f.business })) {
      const client = createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
      const { error } = await client.auth.signInWithPassword({ email: person.email, password: f.password }); if (error) throw error; clients[name] = client;
    }
    expect((await f.db.from("platform_operators").insert({ user_id: f.luca.userId })).error).toBeNull();
    expect((await f.db.from("platform_moderators").insert({ user_id: f.paul.userId })).error).toBeNull();
  });
  afterAll(async () => {
    if (!f) return;
    await f.db.from("platform_staff_events").delete().in("actor_id", [f.luca.userId, f.marco.userId, f.paul.userId]);
    await f.cleanup();
  });
  it("denies customers, business owners and reviewers both staff management and self-promotion", async () => {
    for (const name of ["marco", "paul", "business"]) {
      expect((await clients[name].rpc("is_platform_operator")).data).toBe(false);
      expect((await clients[name].rpc("platform_staff_directory")).error).toBeTruthy();
      expect((await clients[name].rpc("set_platform_reviewer", { p_enabled: true, p_email: f.marco.email })).error).toBeTruthy();
      expect((await clients[name].from("platform_operators").insert({ user_id: f.marco.userId })).error).toBeTruthy();
      expect((await clients[name].from("platform_moderators").upsert({ user_id: f.marco.userId, enabled: true })).error).toBeTruthy();
    }
    const anon = createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    expect((await anon.rpc("set_platform_reviewer", { p_enabled: true, p_email: f.marco.email })).error).toBeTruthy();
    expect((await clients.marco.from("platform_staff_events").select("id")).data).toEqual([]);
  });
  it("grants, revokes and restores reviewer access with idempotent audit and private in-app notifications", async () => {
    const grant = () => clients.luca.rpc("set_platform_reviewer", { p_enabled: true, p_email: ` ${f.marco.email.toUpperCase()} ` });
    const [a, b] = await Promise.all([grant(), grant()]); expect(a.error).toBeNull(); expect(b.error).toBeNull();
    expect([a.data, b.data]).toEqual(expect.arrayContaining([expect.objectContaining({ changed: true }), expect.objectContaining({ changed: false })]));
    expect((await clients.marco.rpc("is_platform_moderator")).data).toBe(true);
    expect((await clients.marco.rpc("is_platform_operator")).data).toBe(false);
    const directory = await clients.luca.rpc("platform_staff_directory"); expect(directory.error).toBeNull(); expect(directory.data).toEqual(expect.arrayContaining([expect.objectContaining({ user_id: f.marco.userId, email: f.marco.email, enabled: true })]));
    expect((await clients.luca.from("platform_staff_events").select("actor_id,target_id,action").eq("target_id", f.marco.userId)).data).toEqual([{ actor_id: f.luca.userId, target_id: f.marco.userId, action: "grant" }]);
    expect((await clients.marco.from("platform_notifications").select("text,link")).data).toEqual([expect.objectContaining({ link: "/moderation" })]);
    expect((await clients.paul.from("platform_notifications").select("id")).data).toEqual([]);
    expect((await clients.luca.rpc("set_platform_reviewer", { p_enabled: false, p_user: f.marco.userId })).error).toBeNull();
    expect((await clients.marco.rpc("is_platform_moderator")).data).toBe(false);
    expect((await clients.marco.rpc("platform_case_queue")).error).toBeTruthy();
    expect((await grant()).error).toBeNull(); expect((await clients.marco.rpc("is_platform_moderator")).data).toBe(true);
    expect((await clients.luca.from("platform_staff_events").select("id").eq("target_id", f.marco.userId)).data).toHaveLength(3);
  });
  it("rejects unknown, unverified, business and malformed targets without creating access", async () => {
    const email = `unverified-${crypto.randomUUID()}@agentme.test`;
    const { data, error } = await f.db.auth.admin.createUser({ email, password: f.password, email_confirm: false }); if (error) throw error;
    try {
      for (const p_email of [email, f.business.email, `missing-${crypto.randomUUID()}@agentme.test`]) expect((await clients.luca.rpc("set_platform_reviewer", { p_enabled: true, p_email })).error).toBeTruthy();
      expect((await clients.luca.rpc("set_platform_reviewer", { p_enabled: false })).error).toBeTruthy();
      expect((await clients.luca.rpc("set_platform_reviewer", { p_enabled: null as unknown as boolean, p_email: f.marco.email })).error).toBeTruthy();
      expect((await clients.luca.rpc("set_platform_reviewer", { p_enabled: true, p_email: f.marco.email, p_user: f.paul.userId })).error).toBeTruthy();
      expect((await f.db.from("platform_moderators").select("user_id").eq("user_id", data.user.id)).data).toEqual([]);
    } finally { await f.db.auth.admin.deleteUser(data.user.id); }
  });
  it("protects operator access and audit history, and enforces operator revocation on every call", async () => {
    expect((await clients.luca.rpc("set_platform_reviewer", { p_enabled: true, p_email: f.luca.email })).error).toBeNull();
    expect((await clients.luca.rpc("set_platform_reviewer", { p_enabled: false, p_user: f.luca.userId })).error).toBeTruthy();
    expect((await clients.luca.from("platform_operators").delete().eq("user_id", f.luca.userId)).error).toBeTruthy();
    expect((await clients.luca.from("platform_staff_events").delete().eq("actor_id", f.luca.userId)).error).toBeTruthy();
    expect((await clients.luca.from("platform_staff_events").insert({ actor_id: f.paul.userId, target_id: f.marco.userId, target_email: f.marco.email, action: "revoke" })).error).toBeTruthy();
    await f.db.from("platform_operators").update({ enabled: false }).eq("user_id", f.luca.userId);
    expect((await clients.luca.rpc("platform_staff_directory")).error).toBeTruthy();
    expect((await clients.luca.rpc("set_platform_reviewer", { p_enabled: true, p_email: f.paul.email })).error).toBeTruthy();
    expect((await clients.luca.from("platform_staff_events").select("id")).data).toEqual([]);
  });
});
