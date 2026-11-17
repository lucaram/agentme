"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { presenceLabel, type PresenceState } from "@/lib/presence/types";
import { useOwnPresence, usePresence } from "./PresenceProvider";

export function StatusDot({ state }: { state: PresenceState | null }) {
  const color = state === "online" ? "bg-emerald-500" : state === "busy" ? "bg-amber-500" : state === "away" ? "bg-slate-400" : "border border-slate-400 bg-transparent";
  return <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`} />;
}
export function OwnPresenceBadge() {
  const { info, state } = useOwnPresence();
  return <span className="inline-flex items-center gap-1.5 text-xs font-normal text-muted" data-testid="own-presence"><StatusDot state={state} />{info?.participating === false ? "Off duty" : info?.mode === "invisible" ? "Appear offline" : state ? info?.business ? `Work: ${presenceLabel(state, false)}` : presenceLabel(state, false) : "Connecting…"}</span>;
}
export function PresenceBadge({ agentId, business = false }: { agentId: string; business?: boolean }) {
  const runtime = usePresence(); const ref = useRef<HTMLSpanElement>(null); const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "80px" });
    observer.observe(ref.current); return () => observer.disconnect();
  }, []);
  const subscribe = useCallback((listener: () => void) => visible && runtime ? runtime.subscribe(agentId, listener) : () => {}, [agentId, visible, runtime]);
  const snapshot = useCallback(() => visible && runtime ? runtime.snapshot(agentId) : null, [agentId, visible, runtime]);
  const state = useSyncExternalStore(subscribe, snapshot, () => null);
  return <span ref={ref} className="inline-flex min-h-px min-w-px align-middle">{state && <span className="inline-flex items-center gap-1.5 text-xs font-normal text-muted" data-testid={`presence-${agentId}`}><StatusDot state={state} />{presenceLabel(state, runtime?.isBusiness(agentId) ?? business)}</span>}</span>;
}
