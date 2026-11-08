"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { browserClient } from "@/lib/supabase/client";

type Tab = "contacts" | "groups" | "communities";
type Counts = Record<Tab, number>;

// One shared store for all tab badges: a single fetch and a single live channel.
let counts: Counts | null = null;
const listeners = new Set<() => void>();
let started = false;
let timer: ReturnType<typeof setTimeout> | undefined;

async function load() {
  const supabase = browserClient();
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return;
  const { data } = await supabase.rpc("action_counts");
  const row = data?.[0];
  if (!row) return;
  counts = { contacts: Number(row.contacts), groups: Number(row.groups), communities: Number(row.communities) };
  listeners.forEach((l) => l());
}

function reload() {
  clearTimeout(timer);
  timer = setTimeout(() => void load(), 200);
}

/** Live updates: anything that changes a count (RLS limits events to the user's own rows). */
async function start() {
  if (started) return;
  started = true;
  const supabase = browserClient();
  const { data } = await supabase.auth.getSession();
  if (data.session) await supabase.realtime.setAuth(data.session.access_token);
  let channel = supabase.channel("tab-badges");
  for (const table of ["contacts", "inbox_items", "join_requests", "reports", "notices"]) {
    channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, reload);
  }
  channel.subscribe();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Things waiting for you on a tab: contact requests and introductions
 * (Contacts); group invites, join requests and reports you handle as admin,
 * and updates (Groups); the same as a moderator (Communities).
 */
export function TabBadge({ tab, initial }: { tab: Tab; initial: number }) {
  const pathname = usePathname();
  const live = useSyncExternalStore(subscribe, () => counts, () => null);
  useEffect(() => {
    void start();
    reload(); // after every navigation (e.g. you just handled something)
  }, [pathname]);
  const n = live ? live[tab] : initial;
  if (n <= 0) return null;
  return (
    <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold text-white dark:text-black" data-testid={`${tab}-badge`} aria-label={`${n} waiting`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}
