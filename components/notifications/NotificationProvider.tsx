"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase/client";
import { NOTIFICATION_EVENT, READ_EVENT, NotificationState } from "@/lib/notifications/types";

const Context = createContext<{ state: NotificationState; refresh: () => void } | null>(null);
export const useNotificationState = () => useContext(Context);
export function useCurrentNotifications() { const context = useNotificationState(); return context?.state.accounts.find((account) => account.current)?.notifications; }

/** Workspace-keyed: aborted/stale responses cannot populate another account. */
export function NotificationProvider({ initial, children }: { initial: NotificationState; children: ReactNode }) {
  const [state, setState] = useState(initial); const [server, setServer] = useState(initial);
  if (initial !== server) { setServer(initial); if (Date.parse(initial.asOf) >= Date.parse(state.asOf)) setState(initial); }
  const router = useRouter(); const pathname = usePathname(); const reloadRef = useRef<() => void>(() => {});
  const { actorId, currentId } = initial;
  useEffect(() => {
    let live = true; let running = false; let again = false; let debounce: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController(); const client = browserClient();
    const refresh = async () => {
      if (!live) return; if (running) { again = true; return; } running = true;
      try {
        const response = await fetch("/api/notifications", { cache: "no-store", signal: controller.signal });
        if (!live) return;
        if (response.redirected || response.status === 401 || response.status === 403) { router.refresh(); return; }
        if (!response.ok) return;
        const next = NotificationState.parse(await response.json()); if (!live) return;
        if (next.actorId !== actorId || next.currentId !== currentId) { router.refresh(); return; }
        setState((previous) => Date.parse(next.asOf) >= Date.parse(previous.asOf) ? next : previous);
        window.dispatchEvent(new CustomEvent(NOTIFICATION_EVENT, { detail: next }));
      } catch { /* Keep this account's last snapshot and retry on reconnect. */ }
      finally { running = false; if (again && live) { again = false; void refresh(); } }
    };
    const schedule = () => { clearTimeout(debounce); debounce = setTimeout(() => { void refresh(); }, 150); };
    const focus = () => { if (document.visibilityState === "visible") schedule(); };
    reloadRef.current = schedule;
    const channel = client.channel(`notification-state-${actorId}-${currentId}`).on("postgres_changes", { event: "*", schema: "public", table: "identity_notification_versions", filter: `user_id=eq.${actorId}` }, schedule);
    void client.auth.getSession().then(async ({ data }) => { if (!live || !data.session) return; await client.realtime.setAuth(data.session.access_token); if (live) channel.subscribe((status) => { if (status === "SUBSCRIBED") schedule(); }); });
    schedule(); const interval = setInterval(focus, 15000);
    window.addEventListener(READ_EVENT, schedule); window.addEventListener("focus", focus); window.addEventListener("online", focus); document.addEventListener("visibilitychange", focus);
    return () => { live = false; controller.abort(); clearTimeout(debounce); clearInterval(interval); reloadRef.current = () => {}; window.removeEventListener(READ_EVENT, schedule); window.removeEventListener("focus", focus); window.removeEventListener("online", focus); document.removeEventListener("visibilitychange", focus); void client.removeChannel(channel); };
  }, [actorId, currentId, router]);
  useEffect(() => { reloadRef.current(); }, [pathname]);
  return <Context.Provider value={{ state, refresh: () => reloadRef.current() }}>{children}</Context.Provider>;
}

export function AccountNotificationBadge({ count, testId, label }: { count: number; testId?: string; label: string }) {
  return count > 0 ? <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold text-white dark:text-black" data-testid={testId} aria-label={`${count} ${label}`}>{count > 99 ? "99+" : count}</span> : null;
}
