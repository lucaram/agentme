"use client";
import { useEffect } from "react";
import { browserClient } from "@/lib/supabase/client";

/** Acknowledges payloads received by this app, independently of whether a chat is viewed. */
export function DeliveryTracker({ userId }: { userId: string }) {
  useEffect(() => {
    const client = browserClient(); let stopped = false; let syncing = false; let flushing = false;
    const queued = new Set<string>(); let timer: ReturnType<typeof setTimeout> | undefined;
    async function flush() {
      if (stopped || flushing || !queued.size) return;
      flushing = true; const ids = [...queued].slice(0, 100);
      try { const { error } = await client.rpc("acknowledge_messages", { p_ids: ids, p_seen: false }); if (!error) ids.forEach((id) => queued.delete(id)); }
      catch { /* Keep queued messages for reconnection or the next sync. */ }
      finally { flushing = false; }
    }
    function queue(id: string) { queued.add(id); clearTimeout(timer); timer = setTimeout(() => { void flush(); }, 300); }
    async function sync() {
      if (stopped || syncing) return; syncing = true;
      try {
        while (!stopped) {
          const { data, error } = await client.rpc("pending_message_deliveries", {}); if (error || !data?.length) break;
          // The complete text/attachment-reference payload has now reached this browser.
          const { error: ackError } = await client.rpc("acknowledge_messages", { p_ids: data.map((message) => message.id), p_seen: false });
          if (ackError || data.length < 100) break;
        }
        await flush();
      } catch { /* Offline: retry on focus, reconnect or the periodic sync. */ }
      finally { syncing = false; }
    }
    const channel = client.channel(`message-delivery-${userId}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (event) => {
      const message = event.new; if (message.id && message.sender_user_id !== userId) queue(message.id);
    });
    void client.auth.getSession().then(async ({ data }) => { if (stopped || !data.session) return; await client.realtime.setAuth(data.session.access_token); if (!stopped) channel.subscribe((status) => { if (status === "SUBSCRIBED") void sync(); }); });
    const timerSync = setInterval(() => { void sync(); }, 30000);
    const online = () => { void sync(); }; window.addEventListener("online", online); window.addEventListener("focus", online);
    return () => { stopped = true; clearTimeout(timer); clearInterval(timerSync); window.removeEventListener("online", online); window.removeEventListener("focus", online); void client.removeChannel(channel); };
  }, [userId]);
  return null;
}
