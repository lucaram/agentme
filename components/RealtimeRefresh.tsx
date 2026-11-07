"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { browserClient } from "@/lib/supabase/client";

type Table = "messages" | "tasks" | "task_exchanges" | "proposals" | "proposal_responses";

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
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sub: RealtimeChannel | undefined;
    let cancelled = false;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 150);
    };

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
        // Catch up on anything that changed while we were connecting or offline.
        if (status === "SUBSCRIBED") refresh();
      });
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (sub) supabase.removeChannel(sub);
    };
  }, [channel, filter, router, tableKey]);
  return null;
}
