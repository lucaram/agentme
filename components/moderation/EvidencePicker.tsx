"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { z } from "zod";
import { Evidence, type TargetKind } from "@/lib/moderation/types";
import { LocalTime } from "@/components/LocalTime";

export const SpaceSnapshot = z.object({ title: z.string().nullable(), description: z.string().nullable(), rules: z.string().nullable() });
export type SpaceSnapshot = z.infer<typeof SpaceSnapshot>;
const Batch = z.object({ messages: z.array(Evidence), next: z.uuid().nullable(), space: SpaceSnapshot });
export const evidenceVersions = (messages: Evidence[]) => Object.fromEntries(messages.filter((m) => m.version).map((m) => [m.id, m.version!]));

export function EvidencePicker({ kind, target, selected, onChange, onSpace, requirePrimary = true }: { kind: TargetKind; target: string; selected: Evidence[]; onChange: Dispatch<SetStateAction<Evidence[]>>; onSpace?: Dispatch<SetStateAction<SpaceSnapshot | null>>; requirePrimary?: boolean }) {
  const [open, setOpen] = useState(kind === "message"); const [messages, setMessages] = useState<Evidence[]>([]); const [next, setNext] = useState<string | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    void fetch(`/api/reports/evidence?kind=${kind}&target=${target}`, { cache: "no-store", signal: abort.signal }).then(async (response) => {
      if (!response.ok) throw new Error(); const data = Batch.parse(await response.json()); setMessages(data.messages); setNext(data.next); onSpace?.(data.space);
      onChange((previous) => {
        const refreshed = previous.map((m) => data.messages.find((fresh) => fresh.id === m.id) ?? m);
        if (kind === "message" && requirePrimary && !refreshed.some((m) => m.id === target)) { const primary = data.messages.find((m) => m.id === target); if (primary) refreshed.push(primary); }
        return refreshed;
      });
    }).catch(() => { if (!abort.signal.aborted) setError("Couldn't load shared messages. You can still explain the concern in words."); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [kind, target, onChange, onSpace, requirePrimary, attempt]);
  const visible = [...selected.filter((m) => !messages.some((other) => other.id === m.id)), ...messages];
  return <section className="space-y-2 rounded-xl border border-border p-3" aria-label="Supporting messages">
    <button type="button" className="btn-ghost" aria-expanded={open} onClick={() => setOpen(!open)}>{kind === "message" ? "Reported message and optional context" : "Select supporting messages"}{selected.length > 0 && ` · ${selected.length} selected`}</button>
    <p className="text-xs text-muted">Share up to five messages. Surrounding messages are optional. Private agent exchanges, attachments and location data are excluded.</p>
    {open && <>{loading && <p role="status" className="text-xs text-muted">Loading messages…</p>}<div className="max-h-80 space-y-2 overflow-y-auto">{visible.map((message) => {
      const checked = selected.some((m) => m.id === message.id); const required = kind === "message" && requirePrimary && message.id === target;
      return <label key={message.id} className={`flex gap-2 rounded-lg border p-2 ${checked ? "border-accent bg-accent-soft" : "border-border"}`}><input type="checkbox" className="mt-1 shrink-0" checked={checked} disabled={required || (!checked && selected.length >= 5)} onChange={(e) => onChange((previous) => e.target.checked ? [...previous, message] : previous.filter((m) => m.id !== message.id))} /><span className="min-w-0"><span className="block text-xs text-muted">{message.author}{message.ai && " · AI"} · <LocalTime iso={message.at} full />{required && " · Reported message"}</span><span className="block whitespace-pre-wrap break-words text-sm">{message.content}</span></span></label>;
    })}</div>{!loading && !visible.length && !error && <p className="text-xs text-muted">No shared messages available.</p>}
    {next && <button type="button" className="btn-ghost" disabled={loading} onClick={async () => {
      setLoading(true); setError("");
      try { const response = await fetch(`/api/reports/evidence?kind=${kind}&target=${target}&before=${next}`, { cache: "no-store" }); if (!response.ok) throw new Error(); const data = Batch.parse(await response.json()); setMessages(data.messages); setNext(data.next); } catch { setError("Couldn't load older messages. Please try again."); } finally { setLoading(false); }
    }}>Older messages</button>}</>}
    {error && <div className="space-y-2"><p role="status" className="text-xs text-muted">{error}</p><button type="button" className="btn-ghost" onClick={() => { setLoading(true); setError(""); setAttempt((n) => n + 1); }}>Retry loading messages</button></div>}
  </section>;
}
