"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { browserClient } from "@/lib/supabase/client";
import { scheduleRefresh } from "@/lib/refresh";

type Table = "messages" | "tasks" | "task_exchanges" | "proposals" | "proposal_responses" | "inbox_items" | "plan_steps" | "step_responses" | "item_claims" | "plan_changes" | "business_sources";

/** A page rendered this recently is already up to date when its socket connects. */
const FRESH_MS = 2000;

/**
 * Re-renders the current server page when rows the user can see change.
 * Supabase Realtime applies the same RLS policies as normal reads, so the
 * socket MUST carry the user's access token before joining: a channel joined
 * anonymously silently receives nothing.
 */
export function RealtimeRefresh({ channel, tables, filter }: { channel: string; tables: Table[]; filter?: string }) {
  const router = useRouter();
  const tableKey = tables.join(",");
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
        sub = sub.on(
          "postgres_changes",
          { event: "*", schema: "public", table, ...(filter && table === "messages" ? { filter } : {}) },
          refresh,
        );
      }
      sub.subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        // Catch up on anything missed while connecting or offline, unless the
        // page was rendered a moment ago (then it is already current).
        if (connectedBefore || Date.now() - mountedAt > FRESH_MS) refresh();
        connectedBefore = true;
      });
    })();

    return () => {
      cancelled = true;
      if (sub) supabase.removeChannel(sub);
    };
  }, [channel, filter, router, tableKey]);
  return null;
}
