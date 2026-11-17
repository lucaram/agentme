import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbUp } from "./env";
import { businessStaffFixture } from "../fixtures/business-staff";
import { DEFAULT_APPEARANCE, type Appearance } from "@/lib/appearance";

describe.skipIf(!dbUp)("appearance per person and selected identity", () => {
  let f: Awaited<ReturnType<typeof businessStaffFixture>>;
  beforeEach(async () => { f = await businessStaffFixture(); });
  afterEach(async () => { await f?.cleanup(); });
  const purple: Appearance = { ...DEFAULT_APPEARANCE, accent: "purple", theme: "dark", text: "large" };
  const blue: Appearance = { ...DEFAULT_APPEARANCE, accent: "blue", theme: "light", text: "xl", tint: "tinted" };
  async function join() {
    const result = await f.db.from("business_managers").insert([
      { business_agent_id: f.business.agent.id, user_id: f.marco.userId, role: "manager" },
      { business_agent_id: f.business.agent.id, user_id: f.paul.userId, role: "staff", supervisor_id: f.marco.userId },
    ]);
    expect(result.error).toBeNull();
  }

  it("preserves the legacy baseline but separates later personal and work choices across devices", async () => {
    await join();
    expect((await f.db.from("agents").update({ appearance: purple }).eq("id", f.marco.agent.id)).error).toBeNull();
    const personal = await f.signed(f.marco), work = await f.signed(f.marco, true);
    expect((await personal.rpc("current_identity_appearance")).data).toEqual(purple);
    expect((await work.rpc("current_identity_appearance")).data).toEqual(purple);
    expect((await personal.rpc("set_identity_appearance", { p_appearance: blue })).error).toBeNull();
    expect((await work.rpc("current_identity_appearance")).data).toEqual(purple);
    expect((await work.rpc("set_identity_appearance", { p_appearance: DEFAULT_APPEARANCE })).error).toBeNull();
    expect((await personal.rpc("current_identity_appearance")).data).toEqual(blue);
    expect((await (await f.signed(f.marco, true)).rpc("current_identity_appearance")).data).toEqual(DEFAULT_APPEARANCE);
    expect((await (await f.signed(f.marco)).rpc("current_identity_appearance")).data).toEqual(blue);
  });

  it("lets Staff customise their work view without changing the business, Manager or personal settings", async () => {
    await join();
    const staff = await f.signed(f.paul, true), manager = await f.signed(f.marco, true);
    expect((await staff.rpc("set_identity_appearance", { p_appearance: purple })).error).toBeNull();
    expect((await manager.rpc("set_identity_appearance", { p_appearance: blue })).error).toBeNull();
    expect((await staff.rpc("current_identity_appearance")).data).toEqual(purple);
    expect((await manager.rpc("current_identity_appearance")).data).toEqual(blue);
    expect((await f.owner.rpc("current_identity_appearance")).data).toEqual({});
    expect((await (await f.signed(f.paul)).rpc("current_identity_appearance")).data).toEqual({});
    expect((await staff.from("identity_appearance").select("user_id,agent_id")).data).toEqual([{ user_id: f.paul.userId, agent_id: f.business.agent.id }]);
    expect((await manager.from("identity_appearance").select("user_id")).data).toEqual([{ user_id: f.marco.userId }]);
    expect((await f.db.from("agents").select("appearance").eq("id", f.business.agent.id).single()).data?.appearance).toEqual({});
  });

  it("keeps separate choices for two businesses owned by the same person", async () => {
    // The second disposable business is an independent identity, not a shared palette.
    const second = await businessStaffFixture();
    try {
      for (const business of [f.business, second.business]) {
        expect((await f.db.from("business_managers").insert({ business_agent_id: business.agent.id, user_id: f.marco.userId, role: "owner" })).error).toBeNull();
      }
      const firstWork = await f.signed(f.marco, true);
      const secondWork = await second.signed(f.marco, true);
      expect((await firstWork.rpc("set_identity_appearance", { p_appearance: purple })).error).toBeNull();
      expect((await secondWork.rpc("set_identity_appearance", { p_appearance: blue })).error).toBeNull();
      expect((await firstWork.rpc("current_identity_appearance")).data).toEqual(purple);
      expect((await secondWork.rpc("current_identity_appearance")).data).toEqual(blue);
      expect((await (await f.signed(f.marco)).rpc("current_identity_appearance")).data).toEqual({});
    } finally { await second.cleanup(); }
  });

  it("rejects forged preference writes, invalid values, anonymous access and revoked work sessions", async () => {
    await join();
    const work = await f.signed(f.paul, true);
    for (const value of [{}, { ...purple, accent: "unsafe" }, { ...purple, theme: null }, { ...purple, extra: "ignored" }]) {
      expect((await work.rpc("set_identity_appearance", { p_appearance: value })).error).toBeTruthy();
    }
    expect((await work.from("identity_appearance").upsert({ user_id: f.marco.userId, agent_id: f.business.agent.id, appearance: purple })).error).toBeTruthy();
    const anonymous = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    expect((await anonymous.rpc("current_identity_appearance")).error).toBeTruthy();
    expect((await anonymous.rpc("set_identity_appearance", { p_appearance: purple })).error).toBeTruthy();
    expect((await work.rpc("set_identity_appearance", { p_appearance: purple })).error).toBeNull();
    expect((await f.db.from("business_managers").delete().eq("business_agent_id", f.business.agent.id).eq("user_id", f.paul.userId)).error).toBeNull();
    expect((await work.rpc("set_identity_appearance", { p_appearance: blue })).error).toBeTruthy();
    expect((await work.from("identity_appearance").select("user_id")).data).toEqual([]);
  });
});
