"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { browserClient } from "@/lib/supabase/client";
import { aggregatePresence, automaticState, IDLE_MS, OFFLINE_GRACE_MS, PresenceSnapshot, type PresenceOwn, type PresencePeer, type PresenceState } from "@/lib/presence/types";

type OwnSnapshot = { info: PresenceOwn | null; state: PresenceState | null };
type Entry = { info: PresencePeer; channel: RealtimeChannel; state: PresenceState | null; offlineTimer?: ReturnType<typeof setTimeout> };
const EMPTY: OwnSnapshot = { info: null, state: null };

/** One subscription per visible identity, shared by every badge on the current page. */
class PresenceRuntime {
  private client: ReturnType<typeof browserClient> | null = null;
  private own: OwnSnapshot = EMPTY;
  private selfChannel: RealtimeChannel | null = null;
  private staffChannel: RealtimeChannel | null = null;
  private staffReady = false;
  private staffPublished = "";
  private selfTopic = "";
  private selfReady = false;
  private published = "";
  private stopped = true;
  private refreshing = false;
  private queued = false;
  private lifecycle = 0;
  private lastActivity = Date.now();
  private verifiedAt = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private ownListeners = new Set<() => void>();
  private listeners = new Map<string, Set<() => void>>();
  private entries = new Map<string, Entry>();
  constructor(private userId: string, private agentId: string) {}

  subscribeOwn = (listener: () => void) => { this.ownListeners.add(listener); return () => { this.ownListeners.delete(listener); }; };
  ownSnapshot = () => this.own;
  serverSnapshot = () => EMPTY;
  subscribe = (id: string, listener: () => void) => {
    const listeners = this.listeners.get(id) ?? new Set(); listeners.add(listener); this.listeners.set(id, listeners); this.schedule();
    return () => { listeners.delete(listener); if (!listeners.size) { this.listeners.delete(id); this.drop(id); } };
  };
  snapshot = (id: string) => this.entries.get(id)?.state ?? null;
  isBusiness = (id: string) => this.entries.get(id)?.info.business;
  private notify(id: string) { this.listeners.get(id)?.forEach((listener) => listener()); }
  private setOwn(info: PresenceOwn | null, state: PresenceState | null) {
    if (JSON.stringify(this.own.info) === JSON.stringify(info) && this.own.state === state) return;
    this.own = { info, state }; this.ownListeners.forEach((listener) => listener());
  }
  private drop(id: string) {
    const entry = this.entries.get(id); if (!entry) return;
    this.entries.delete(id); clearTimeout(entry.offlineTimer); if (this.client) void this.client.removeChannel(entry.channel); this.notify(id);
  }
  private retireSelf() {
    if (this.staffChannel && this.client) { void this.staffChannel.untrack(); void this.client.removeChannel(this.staffChannel); }
    this.staffChannel = null; this.staffReady = false; this.staffPublished = "";
    const old = this.selfChannel; this.selfChannel = null; this.selfTopic = ""; this.selfReady = false; this.published = "";
    if (old && this.client) { void old.untrack(); void this.client.removeChannel(old); }
  }
  private clear() { this.retireSelf(); for (const id of this.entries.keys()) this.drop(id); this.setOwn(null, null); }
  private schedule = () => {
    if (this.stopped) return;
    clearTimeout(this.timer); this.timer = setTimeout(() => { void this.refresh(); }, 100);
  };
  private publish() {
    const info = this.own.info;
    if (this.stopped || !info || !this.selfReady || !this.selfChannel || Date.now() - this.verifiedAt > 30_000) return;
    const state = automaticState(info.mode, document.visibilityState === "visible", this.lastActivity, Date.now());
    this.setOwn(info, navigator.onLine && info.participating !== false ? state : "offline");
    if (info.mode === "invisible" || info.participating === false) {
      // No payload, presence key or connected-device count may reveal invisible users.
      if (this.published) { this.published = ""; void this.selfChannel.untrack(); }
      if (this.staffChannel && this.staffPublished) { this.staffPublished = ""; void this.staffChannel.untrack(); }
      return;
    }
    if (state !== this.published) {
      this.published = state; const channel = this.selfChannel;
      void channel.track({ state }).then((result) => { if (result !== "ok" && this.selfChannel === channel) this.published = ""; });
    }
    if (this.staffChannel && this.staffReady && state !== this.staffPublished) {
      this.staffPublished = state; const staff = this.staffChannel;
      void staff.track({ state }).then((result) => { if (result !== "ok" && this.staffChannel === staff) this.staffPublished = ""; });
    }
  }
  private connectSelf(info: PresenceOwn) {
    if (!this.client) return;
    if (info.topic !== this.selfTopic) {
      this.retireSelf(); this.selfTopic = info.topic;
      const channel = this.client.channel(info.topic, { config: { private: true, presence: { key: crypto.randomUUID(), enabled: true } } });
      this.selfChannel = channel;
      if (info.staffTopic) {
        const staff = this.client.channel(info.staffTopic, { config: { private: true, presence: { key: crypto.randomUUID(), enabled: true } } }); this.staffChannel = staff;
        staff.subscribe((status) => { if (this.stopped || this.staffChannel !== staff) return; this.staffReady = status === "SUBSCRIBED"; if (this.staffReady) { this.staffPublished = ""; this.publish(); } });
      }
      channel.subscribe((status) => {
        if (this.stopped || this.selfChannel !== channel) return;
        this.selfReady = status === "SUBSCRIBED";
        if (this.selfReady) { this.published = ""; this.publish(); }
        else { this.published = ""; this.setOwn(this.own.info, null); }
      });
    }
    this.publish();
  }
  private connectPeer(info: PresencePeer) {
    if (!this.client) return;
    if (this.entries.get(info.id)?.info.topic === info.topic) return;
    this.drop(info.id);
    // Viewer subscriptions never publish a presence payload.
    const channel = this.client.channel(info.topic, { config: { private: true } });
    const entry: Entry = { info, channel, state: null }; this.entries.set(info.id, entry);
    channel.on("presence", { event: "sync" }, () => {
      if (this.stopped || this.entries.get(info.id) !== entry) return;
      const state = aggregatePresence(Object.values(channel.presenceState()).flat());
      clearTimeout(entry.offlineTimer);
      if (state === "offline") {
        // Refresh authorization as soon as a publisher retires an old audience.
        this.schedule();
        entry.offlineTimer = setTimeout(() => { if (this.entries.get(info.id) === entry) { entry.state = "offline"; this.notify(info.id); } }, OFFLINE_GRACE_MS);
      } else { entry.state = state; this.notify(info.id); }
    }).subscribe((status) => {
      if (this.entries.get(info.id) !== entry || this.stopped) return;
      if (status !== "SUBSCRIBED") { clearTimeout(entry.offlineTimer); entry.state = null; this.notify(info.id); }
    });
  }

  refresh = async () => {
    if (this.stopped) return;
    if (this.refreshing) { this.queued = true; return; }
    this.refreshing = true;
    const lifecycle = this.lifecycle;
    try {
      const ids = [...this.listeners.keys()].filter((id) => id !== this.agentId);
      const batches = Array.from({ length: Math.max(1, Math.ceil(ids.length / 100)) }, (_, i) => ids.slice(i * 100, (i + 1) * 100));
      const responses = await Promise.all(batches.map(async (batch) => {
        const response = await fetch(`/api/presence?ids=${batch.join(",")}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Presence unavailable"); return PresenceSnapshot.parse(await response.json());
      }));
      if (this.stopped || lifecycle !== this.lifecycle) return;
      const info = responses[0].own;
      if (info.id !== this.agentId) { this.clear(); return; }
      const session = (await this.client!.auth.getSession()).data.session;
      if (!session || session.user.id !== this.userId) { this.clear(); return; }
      await this.client!.realtime.setAuth(session.access_token);
      if (this.stopped || lifecycle !== this.lifecycle) return;
      this.verifiedAt = Date.now();
      this.setOwn(info, this.selfReady && this.selfTopic === info.topic ? automaticState(info.mode, document.visibilityState === "visible", this.lastActivity, Date.now()) : null);
      this.connectSelf(info);
      const allowed = new Map(responses.flatMap((response) => response.peers).map((peer) => [peer.id, peer]));
      for (const id of this.entries.keys()) if (!allowed.has(id) || !this.listeners.has(id)) this.drop(id);
      for (const peer of allowed.values()) if (this.listeners.has(peer.id)) this.connectPeer(peer);
    } catch {
      if (this.stopped || lifecycle !== this.lifecycle) return;
      // Unknown/unavailable is never presented as somebody else's Offline status.
      for (const id of this.entries.keys()) this.drop(id);
      if (Date.now() - this.verifiedAt > 30_000) { this.retireSelf(); this.setOwn(this.own.info, null); }
    } finally { this.refreshing = false; if (this.queued && !this.stopped) { this.queued = false; this.schedule(); } }
  };
  start() {
    this.client = browserClient(); this.stopped = false; this.lifecycle++;
    const activity = () => { const wasIdle = Date.now() - this.lastActivity >= IDLE_MS; this.lastActivity = Date.now(); if (wasIdle && this.own.info?.mode === "auto") this.schedule(); };
    const visibility = () => { this.schedule(); };
    const offline = () => { for (const id of this.entries.keys()) this.drop(id); this.setOwn(this.own.info, "offline"); };
    const stop = () => { this.stopped = true; this.clear(); };
    const resume = (event: PageTransitionEvent) => { if (event.persisted) { this.stopped = false; this.schedule(); } };
    window.addEventListener("pointermove", activity, { passive: true }); window.addEventListener("pointerdown", activity, { passive: true }); window.addEventListener("keydown", activity);
    document.addEventListener("visibilitychange", visibility); window.addEventListener("online", visibility); window.addEventListener("offline", offline);
    window.addEventListener("pagehide", stop); window.addEventListener("pageshow", resume); window.addEventListener("agentme-presence-stop", stop);
    const interval = setInterval(() => { void this.refresh(); }, 10_000);
    const subscription = this.client.auth.onAuthStateChange((event, session) => { if (event === "SIGNED_OUT" || session && session.user.id !== this.userId) { this.clear(); } else this.schedule(); });
    const preferences = this.client.channel(`presence-preferences-${this.agentId}`).on("postgres_changes", { event: "UPDATE", schema: "public", table: "presence_preferences", filter: `agent_id=eq.${this.agentId}` }, this.schedule);
    void this.client.auth.getSession().then(async ({ data }) => { if (this.stopped || data.session?.user.id !== this.userId) return; await this.client!.realtime.setAuth(data.session.access_token); if (!this.stopped) preferences.subscribe(); });
    void this.refresh();
    return () => {
      this.stopped = true; this.lifecycle++; this.clear(); clearInterval(interval); clearTimeout(this.timer); subscription.data.subscription.unsubscribe();
      void this.client!.removeChannel(preferences);
      window.removeEventListener("pointermove", activity); window.removeEventListener("pointerdown", activity); window.removeEventListener("keydown", activity);
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("online", visibility); window.removeEventListener("offline", offline);
      window.removeEventListener("pagehide", stop); window.removeEventListener("pageshow", resume); window.removeEventListener("agentme-presence-stop", stop);
    };
  }
}

const Context = createContext<PresenceRuntime | null>(null);
export function PresenceProvider({ userId, agentId, children }: { userId: string; agentId: string; children: ReactNode }) {
  const [runtime] = useState(() => new PresenceRuntime(userId, agentId));
  useEffect(() => runtime.start(), [runtime]);
  return <Context.Provider value={runtime}>{children}</Context.Provider>;
}
export function usePresence() { return useContext(Context); }
export function useOwnPresence() {
  const runtime = useContext(Context);
  return useSyncExternalStore(runtime?.subscribeOwn ?? (() => () => {}), runtime?.ownSnapshot ?? (() => EMPTY), () => EMPTY);
}
