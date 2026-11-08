"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { browserClient } from "@/lib/supabase/client";

export const READ_EVENT = "agentme:read";

/** Total unread messages across the user's chats (RLS: only their own memberships). */
async function fetchTotal(): Promise<number | null> {
  const supabase = browserClient();
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return null;
  const { data, error } = await supabase.rpc("unread_counts");
  if (error) return null;
  return (data ?? []).filter((r) => !r.muted).reduce((n, r) => n + Number(r.unread), 0);
}

/**
 * Total unread messages for the Chats tab. It loads its own count whenever the
 * page changes, a chat is marked read (READ_EVENT) or a new message arrives,
 * instead of relying on the header being re-rendered, which Next.js doesn't do
 * on client navigation.
 */
export function ChatsBadge({ initial }: { initial: number }) {
  const [count, setCount] = useState(initial);
  // A fresh server value (the header re-rendered, e.g. after router.refresh) wins.
  const [serverValue, setServerValue] = useState(initial);
  if (initial !== serverValue) {
    setServerValue(initial);
    setCount(initial);
  }
  const pathname = usePathname();

  useEffect(() => {
    let live = true;
    fetchTotal().then((n) => {
      if (live && n !== null) setCount(n);
    });
    return () => {
      live = false;
    };
  }, [pathname]);

  useEffect(() => {
    let live = true;
    const reload = () => {
      fetchTotal().then((n) => {
        if (live && n !== null) setCount(n);
      });
    };
    window.addEventListener(READ_EVENT, reload);
    const supabase = browserClient();
    // New messages, and requests waiting in My Agent being created or answered.
    const channel = supabase
      .channel("chats-badge")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "inbox_items" }, reload);
    supabase.auth.getSession().then(async ({ data }) => {
      if (!live) return;
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      channel.subscribe();
    });
    return () => {
      live = false;
      window.removeEventListener(READ_EVENT, reload);
      supabase.removeChannel(channel);
    };
  }, []);

  if (count <= 0) return null;
  return (
    <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold text-white dark:text-black" data-testid="chats-badge" aria-label={`${count} unread`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}
