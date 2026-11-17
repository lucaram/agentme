"use client";

import { useOptimistic, useState, useTransition } from "react";
import { setPresenceMode, setWorkParticipation } from "@/app/(app)/presence-actions";
import type { PresenceMode } from "@/lib/presence/types";
import { useOwnPresence, usePresence } from "./PresenceProvider";
import { StatusDot } from "./PresenceBadge";
import { LocalTime } from "@/components/LocalTime";

export function PresenceControl() {
  const runtime = usePresence(); const { info } = useOwnPresence();
  const [participating, setParticipating] = useOptimistic(info?.participating !== false);
  const [minutes, setMinutes] = useState<number | null>(60); const [error, setError] = useState(""); const [pending, start] = useTransition();
  const choose = (mode: PresenceMode, duration = minutes) => start(async () => {
    setError("");
    try { const result = await setPresenceMode(mode, mode === "busy" ? duration : null); if (result.error) setError(result.error); else await runtime?.refresh(); }
    catch { setError("Couldn't update your status. Please try again."); }
  });
  return <div className="mt-2 border-t border-border px-2 pt-2" role="group" aria-label="Set your status">
    <p className="mb-1 text-xs text-muted">{info?.business ? "Your work availability" : "Your status"}</p>
    {info?.business && <label className="mb-2 flex items-start gap-2 text-xs"><input type="checkbox" aria-label="Available for customer requests" checked={participating} disabled={pending} onChange={(event) => { const available = event.target.checked; start(async () => { setParticipating(available); setError(""); try { const result = await setWorkParticipation(available); if (result.error) setError(result.error); else await runtime?.refresh(); } catch { setError("Couldn't update work availability. Please try again."); } }); }} /><span>Available for customer requests</span></label>}
    {([["auto", "Online (automatic)", "online"], ["busy", "Busy", "busy"], ["away", "Away", "away"], ["invisible", "Appear offline", "offline"]] as const).map(([mode, label, state]) => <button key={mode} type="button" aria-pressed={info?.mode === mode} disabled={pending || !info} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${info?.mode === mode ? "bg-accent-soft" : "hover:bg-accent-soft"}`} onClick={() => choose(mode)}><StatusDot state={state} />{label}</button>)}
    <label className="mt-2 flex items-center gap-2 text-xs text-muted">{info?.mode === "busy" ? "Change duration" : "Busy for"}<select aria-label="Busy for" className="input min-w-0 flex-1 py-1 text-xs" disabled={pending} value={info?.mode === "busy" ? "" : minutes ?? "forever"} onChange={(event) => { const value = event.target.value === "forever" ? null : Number(event.target.value); setMinutes(value); if (info?.mode === "busy") choose("busy", value); }}>{info?.mode === "busy" && <option value="" disabled>Choose duration</option>}<option value="60">1 hour</option><option value="240">4 hours</option><option value="forever">Until changed</option></select></label>
    {info?.mode === "busy" && <p className="mt-1 text-xs text-muted" data-testid="busy-until">{info.until ? <>Busy until <LocalTime iso={info.until} /></> : "Busy until changed"}</p>}
    {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
  </div>;
}
