/** Rate limiter and privileged database functions (needs the local Supabase stack). */
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, SUPABASE_URL, admin, dbUp } from "./env";

describe.skipIf(!dbUp)("rate limiting (database)", () => {
  it("allows up to the limit within a window, then reports when to retry", async () => {
    const key = `test:${crypto.randomUUID()}`;
    const results = [];
    for (let i = 0; i < 4; i++) {
      const { data, error } = await admin().rpc("rate_limit_hit", { p_key: key, p_window_seconds: 60, p_max: 3 });
      expect(error).toBeNull();
      results.push(data[0]);
    }
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3].retry_after_seconds).toBeGreaterThan(0);
    expect(results[3].retry_after_seconds).toBeLessThanOrEqual(60);
  });

  it("counts concurrent hits exactly (no lost updates)", async () => {
    const key = `test:${crypto.randomUUID()}`;
    const hits = await Promise.all(
      Array.from({ length: 20 }, () => admin().rpc("rate_limit_hit", { p_key: key, p_window_seconds: 60, p_max: 10 })),
    );
    expect(hits.filter((h) => h.data?.[0]?.allowed).length).toBe(10);
  });

  it("signed-in users cannot call the limiter or the task-lease functions directly", async () => {
    const eve = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await eve.auth.signInWithPassword({ email: "eve@agentme.test", password: "password123" });
    const limiter = await eve.rpc("rate_limit_hit", { p_key: "x", p_window_seconds: 60, p_max: 1000 });
    const claim = await eve.rpc("claim_task", { p_task: crypto.randomUUID(), p_lease_seconds: 60 });
    expect(limiter.error?.code).toBe("42501"); // permission denied
    expect(claim.error?.code).toBe("42501");
    const { data } = await eve.from("rate_limits").select("*");
    expect(data).toEqual([]);
  });
});
