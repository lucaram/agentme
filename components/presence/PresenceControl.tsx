"use client";

import { Fragment, useOptimistic, useState, useTransition } from "react";
import { setPresenceMode, setWorkParticipation } from "@/app/(app)/presence-actions";
import type { PresenceMode } from "@/lib/presence/types";
import { useOwnPresence, usePresence } from "./PresenceProvider";
import { StatusDot } from "./PresenceBadge";
import { LocalTime } from "@/components/LocalTime";

export function PresenceControl() {
  const runtime = usePresence(); const { info } = useOwnPresence();
  const [participating, setParticipating] = useOptimistic(info?.participating !== false);
  const [error, setError] = useState(""); const [pending, start] = useTransition();
  // The length last picked here (a reload only knows "until a time" or "until changed").
  const [picked, setPicked] = useState<number | null | undefined>(undefined);
  // Busy starts "until changed"; a length is chosen afterwards, from now.
  const choose = (mode: PresenceMode, minutes: number | null = null) => start(async () => {
    setError("");
    try { const result = await setPresenceMode(mode, mode === "busy" ? minutes : null); if (result.error) setError(result.error); else { setPicked(mode === "busy" ? minutes : undefined); await runtime?.refresh(); } }
    catch { setError("Couldn't update your status. Please try again."); }
  });
  const busyLength = info?.mode === "busy" && <div className="mb-1 ml-6 mt-1 space-y-1" data-testid="busy-length">
    <div className="flex flex-wrap gap-1" role="group" aria-label="How long">
      {([[60, "1 hour"], [240, "4 hours"], [null, "Until changed"]] as const).map(([minutes, label]) => {
        const on = picked !== undefined ? picked === minutes : minutes === null && !info.until;
        return <button key={label} type="button" aria-pressed={on} disabled={pending} onClick={() => choose("busy", minutes)} className={`rounded-full border px-2 py-0.5 text-xs ${on ? "border-accent bg-accent-soft font-medium" : "border-border text-muted hover:bg-accent-soft"}`}>{label}</button>;
      })}
    </div>
    <p className="text-xs text-muted" data-testid="busy-until">{info.until ? <>Busy until <LocalTime iso={info.until} />, then Online</> : "Busy until changed"}</p>
  </div>;
  return <div className="mt-2 border-t border-border px-2 pt-2" role="group" aria-label="Set your status">
    <p className="mb-1 text-xs text-muted">{info?.business ? "Your work availability" : "Your status"}</p>
    {info?.business && <label className="mb-2 flex items-start gap-2 text-xs"><input type="checkbox" aria-label="Available for customer requests" checked={participating} disabled={pending} onChange={(event) => { const available = event.target.checked; start(async () => { setParticipating(available); setError(""); try { const result = await setWorkParticipation(available); if (result.error) setError(result.error); else await runtime?.refresh(); } catch { setError("Couldn't update work availability. Please try again."); } }); }} /><span>Available for customer requests</span></label>}
    {([["auto", "Online (automatic)", "online"], ["busy", "Busy", "busy"], ["away", "Away", "away"], ["invisible", "Appear offline", "offline"]] as const).map(([mode, label, state]) => <Fragment key={mode}><button type="button" aria-pressed={info?.mode === mode} disabled={pending || !info} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${info?.mode === mode ? "bg-accent-soft" : "hover:bg-accent-soft"}`} onClick={() => { if (info?.mode !== mode) choose(mode); }}><StatusDot state={state} />{label}</button>{mode === "busy" && busyLength}</Fragment>)}
    {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
  </div>;
}
