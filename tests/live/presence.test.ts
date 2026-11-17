import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import { ANON_KEY, dbUp, SUPABASE_URL } from "./env";
import { planBusinessFixture } from "../fixtures/plan-business";
import { PresenceOwn, aggregatePresence } from "@/lib/presence/types";
import type { Database } from "@/lib/database.types";

type PresenceClient = ReturnType<typeof createClient<Database>>;

describe.skipIf(!dbUp)("private online presence", () => {
  let f: Awaited<ReturnType<typeof planBusinessFixture>>;
  const clients: PresenceClient[] = [];
  let luca: PresenceClient, marco: PresenceClient, paul: PresenceClient, business: PresenceClient;
  const own = async (client: PresenceClient) => { const result = await client.rpc("presence_self"); expect(result.error).toBeNull(); return PresenceOwn.parse(result.data); };
  beforeAll(async () => {
    f = await planBusinessFixture();
    for (const account of [f.luca, f.marco, f.paul, f.business]) {
      const client = createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
      const signed = await client.auth.signInWithPassword({ email: account.email, password: f.password }); if (signed.error) throw signed.error;
      await client.realtime.setAuth(signed.data.session!.access_token); clients.push(client);
    }
    [luca, marco, paul, business] = clients;
    expect((await f.db.from("contacts").insert({ requester_agent: f.luca.agent.id, addressee_agent: f.marco.agent.id, status: "accepted" })).error).toBeNull();
  });
  afterAll(async () => { for (const client of clients) { await client.removeAllChannels(); await client.auth.signOut(); } await f?.cleanup(); });

  it("defaults personal visibility to contacts and business team visibility to opt-in", async () => {
    expect(await own(luca)).toMatchObject({ mode: "auto", visibility: "contacts", business: false });
    expect(await own(business)).toMatchObject({ mode: "auto", visibility: "nobody", business: true });
  });
  it("returns only permitted channel addresses, never another person's mode or activity timestamps", async () => {
    const visible = await marco.rpc("presence_channels", { p_ids: [f.luca.agent.id, f.business.agent.id] }); expect(visible.error).toBeNull();
    expect(visible.data).toEqual([{ id: f.luca.agent.id, business: false, topic: (await own(luca)).topic }]);
    expect((await paul.rpc("presence_channels", { p_ids: [f.luca.agent.id] })).data).toEqual([]);
    const privateRead = await marco.from("presence_preferences").select("*").eq("agent_id", f.luca.agent.id); expect(privateRead.error).toBeNull(); expect(privateRead.data).toEqual([]);
    expect((await marco.from("presence_preferences").update({ mode: "busy" }).eq("agent_id", f.luca.agent.id)).error).toBeTruthy();
    expect((await createClient(SUPABASE_URL, ANON_KEY).rpc("presence_channels", { p_ids: [f.luca.agent.id] })).error).toBeTruthy();
  });
  it("enforces private Realtime read and publish access against real sockets", async () => {
    const topic = (await own(luca)).topic;
    const join = (channel: RealtimeChannel) => new Promise<string>((resolve) => { const timer = setTimeout(() => resolve("TIMEOUT"), 9000); channel.subscribe((status, error) => { if (["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT"].includes(status)) { clearTimeout(timer); resolve(error ? `${status}: ${error.message}` : status); } }); });
    const publisher = luca.channel(topic, { config: { private: true, presence: { key: "owner-tab", enabled: true } } });
    const viewer = marco.channel(topic, { config: { private: true } }).on("presence", { event: "sync" }, () => {});
    const stranger = paul.channel(topic, { config: { private: true, presence: { enabled: true } } });
    try {
      expect(await join(publisher)).toBe("SUBSCRIBED"); expect(await join(viewer)).toBe("SUBSCRIBED"); expect(await join(stranger)).toContain("CHANNEL_ERROR");
      expect((await marco.rpc("presence_channel_access", { p_topic: topic, p_write: true })).data).toBe(false);
      expect(await viewer.track({ state: "busy" })).toBe("error");
      expect(await publisher.track({ state: "online" })).toBe("ok");
      await expect.poll(() => aggregatePresence(Object.values(viewer.presenceState()).flat())).toBe("online");
      await publisher.untrack(); await expect.poll(() => aggregatePresence(Object.values(viewer.presenceState()).flat())).toBe("offline");
    } finally { await luca.removeChannel(publisher); await marco.removeChannel(viewer); await paul.removeChannel(stranger); }
  }, 20_000);
  it("keeps status and identity private, expires timed Busy, and does not publish 'invisible' to peers", async () => {
    const original = await own(luca);
    expect((await luca.rpc("set_presence_mode", { p_mode: "busy", p_minutes: 60 })).error).toBeNull();
    const busy = await own(luca); expect(busy.mode).toBe("busy"); expect(busy.topic).not.toBe(original.topic); expect(Date.parse(busy.until!)).toBeGreaterThan(Date.now());
    expect((await f.db.from("presence_preferences").update({ mode_until: new Date(Date.now() - 1000).toISOString() }).eq("agent_id", f.luca.agent.id)).error).toBeNull();
    expect(await own(luca)).toMatchObject({ mode: "auto", until: null });
    expect((await luca.rpc("set_presence_mode", { p_mode: "invisible" })).error).toBeNull();
    expect(JSON.stringify((await marco.rpc("presence_channels", { p_ids: [f.luca.agent.id] })).data)).not.toContain("invisible");
    expect((await own(marco)).mode).toBe("auto"); expect((await own(business)).mode).toBe("auto");
    expect((await luca.rpc("set_presence_mode", { p_mode: "online", p_minutes: 1 })).error).toBeTruthy();
    await luca.rpc("set_presence_mode", { p_mode: "auto" });
  });
  it("hides status at the source and retires the previously authorised channel", async () => {
    const previous = await own(luca);
    expect((await luca.rpc("set_presence_visibility", { p_visibility: "nobody" })).error).toBeNull();
    expect((await marco.rpc("presence_channels", { p_ids: [f.luca.agent.id] })).data).toEqual([]);
    expect((await own(luca)).topic).not.toBe(previous.topic);
    expect((await luca.rpc("presence_channel_access", { p_topic: previous.topic, p_write: true })).data).toBe(false);
    expect((await luca.rpc("set_presence_visibility", { p_visibility: "customers" })).error).toBeTruthy();
    await luca.rpc("set_presence_visibility", { p_visibility: "contacts" });
  });
  it("lets customers see business team availability only when enabled; block overrides that permission", async () => {
    expect((await business.rpc("set_presence_visibility", { p_visibility: "customers" })).error).toBeNull();
    expect((await paul.rpc("presence_channels", { p_ids: [f.business.agent.id] })).data).toEqual([{ id: f.business.agent.id, business: true, topic: (await own(business)).topic }]);
    const previous = await own(business);
    expect((await f.db.from("contacts").insert({ requester_agent: f.paul.agent.id, addressee_agent: f.business.agent.id, status: "blocked", blocked_by: f.business.agent.id })).error).toBeNull();
    expect((await paul.rpc("presence_channels", { p_ids: [f.business.agent.id] })).data).toEqual([]);
    expect((await own(business)).topic).not.toBe(previous.topic);
  });
  it("removing or blocking a personal contact revokes access even to known topics", async () => {
    const before = await own(luca);
    expect((await f.db.from("contacts").update({ status: "blocked", blocked_by: f.luca.agent.id }).eq("requester_agent", f.luca.agent.id).eq("addressee_agent", f.marco.agent.id)).error).toBeNull();
    expect((await own(luca)).topic).not.toBe(before.topic);
    expect((await marco.rpc("presence_channels", { p_ids: [f.luca.agent.id] })).data).toEqual([]);
    expect((await marco.rpc("presence_channel_access", { p_topic: (await own(luca)).topic, p_write: false })).data).toBe(false);
  });
  it("rejects a logged-out JWT instead of treating it as a connected human", async () => {
    const session = (await paul.auth.getSession()).data.session!;
    expect((await paul.auth.signOut()).error).toBeNull();
    const result = await fetch(`${SUPABASE_URL}/rest/v1/rpc/presence_self`, { method: "POST", headers: { apikey: ANON_KEY, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: "{}" });
    expect(await result.json()).toBeNull();
  });
});
