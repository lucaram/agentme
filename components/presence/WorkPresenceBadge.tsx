"use client";

import { useEffect, useRef, useState } from "react";
import { browserClient } from "@/lib/supabase/client";
import { aggregatePresence, type PresenceState } from "@/lib/presence/types";
import { StatusDot } from "./PresenceBadge";
import { useOwnPresence } from "./PresenceProvider";

/** Work availability only, on a private team-only channel. Never personal presence. */
export function WorkPresenceBadge({ topic, participating, self = false }: { topic: string; participating: boolean; self?: boolean }) {
  const own = useOwnPresence();
  const ref = useRef<HTMLSpanElement>(null); const [visible, setVisible] = useState(false); const [state, setState] = useState<PresenceState | null>(null);
  useEffect(() => { if (!ref.current) return; const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting)); observer.observe(ref.current); return () => observer.disconnect(); }, []);
  useEffect(() => {
    if (self || !visible || !participating) return;
    let stopped = false; const client = browserClient();
    const channel = client.channel(topic, { config: { private: true } }).on("presence", { event: "sync" }, () => { if (!stopped) setState(aggregatePresence(Object.values(channel.presenceState()).flat())); });
    void client.auth.getSession().then(async ({ data }) => { if (stopped || !data.session) return; await client.realtime.setAuth(data.session.access_token); if (!stopped) channel.subscribe(); });
    return () => { stopped = true; void client.removeChannel(channel); };
  }, [topic, visible, participating, self]);
  const current = self ? own.state : state;
  return <span ref={ref} className="inline-flex min-h-px min-w-px items-center gap-1.5 text-xs text-muted"><StatusDot state={participating ? current : "offline"} />{!participating ? "Off duty" : current ? current[0].toUpperCase() + current.slice(1) : "Available for requests"}</span>;
}
