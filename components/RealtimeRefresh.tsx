"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { browserClient } from "@/lib/supabase/client";
import { scheduleRefresh } from "@/lib/refresh";

type Table = "business_queue_versions" | "presence_preferences" | "agent_threads" | "messages" | "tasks" | "task_exchanges" | "proposals" | "proposal_responses" | "inbox_items" | "plan_steps" | "step_responses" | "item_claims" | "plan_changes" | "business_sources" | "business_sites" | "business_action_events" | "business_action_versions" | "message_receipt_versions" | "message_reaction_versions" | "reports" | "platform_cases" | "platform_notifications" | "platform_moderators" | "platform_operators" | "platform_staff_events" | "platform_evidence_requests" | "platform_account_sanctions" | "platform_account_appeals" | "account_access_versions";

/** A page rendered this recently is already up to date when its socket connects. */
const FRESH_MS = 2000;

/**
 * Re-renders the current server page when rows the user can see change.
 * Supabase Realtime applies the same RLS policies as normal reads, so the
 * socket MUST carry the user's access token before joining: a channel joined
 * anonymously silently receives nothing.
 */
export function RealtimeRefresh({ channel, tables, filter, businessIds = [] }: { channel: string; tables: Table[]; filter?: string; businessIds?: string[] }) {
  const router = useRouter();
  const tableKey = tables.join(",");
  const businessKey = [...new Set(businessIds)].sort().join(",");
  useEffect(() => {
    const supabase = browserClient();
    const mountedAt = Date.now();
    let sub: RealtimeChannel | undefined;
    let cancelled = false;
    let connectedBefore = false;
    // Shared with every other refresher on the page: simultaneous changes cause one render.
    const refresh = () => scheduleRefresh(() => router.refresh());

    (async () => {
      // Load the session from cookies and authenticate the socket first.
      const { data } = await supabase.auth.getSession();
      if (cancelled || !data.session) return;
      await supabase.realtime.setAuth(data.session.access_token);
      if (cancelled) return;

      sub = supabase.channel(channel);
      for (const table of tableKey.split(",") as Table[]) {
        if (table === "business_action_versions") {
          for (const id of businessKey.split(",").filter(Boolean)) sub = sub.on("postgres_changes", { event: "*", schema: "public", table, filter: `agent_id=eq.${id}` }, refresh);
          continue;
        }
        sub = sub.on(
          "postgres_changes",
          { event: "*", schema: "public", table, ...(filter && (table === "messages" || table === "message_receipt_versions" || table === "message_reaction_versions") ? { filter } : {}) },
          refresh,
        );
      }
      sub.subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        // Catch up on anything missed while connecting or offline, unless the
        // page was rendered a moment ago (then it is already current).
        if (businessKey || tableKey.includes("message_receipt_versions") || tableKey.includes("platform_") || connectedBefore || Date.now() - mountedAt > FRESH_MS) refresh();
        connectedBefore = true;
      });
    })();

    const focus = () => { if (businessKey && document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      cancelled = true;
      if (sub) supabase.removeChannel(sub);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [channel, filter, router, tableKey, businessKey]);
  return null;
}
