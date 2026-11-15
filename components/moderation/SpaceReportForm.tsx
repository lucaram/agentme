"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";
import { submitPlatformReport, submitMessageReport } from "@/app/(app)/platform-actions";
import { CATEGORIES, Category, type Evidence, type ReportKind, type TargetKind } from "@/lib/moderation/types";
import { EvidencePicker, evidenceVersions, type SpaceSnapshot } from "./EvidencePicker";
import { EvidenceList } from "./EvidenceList";

export function SpaceReportForm({ kind, target, canLeave = true }: { kind: ReportKind; target: string; canLeave?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className="btn-ghost" onClick={() => setOpen(true)}>Report {kind}</button>;
  return <ReportEditor kind={kind} target={target} canLeave={canLeave} onClose={() => setOpen(false)} />;
}

export function ReportEditor({ kind, target, canLeave = false, localDestination, onClose }: { kind: TargetKind; target: string; canLeave?: boolean; localDestination?: "group" | "community"; onClose: () => void }) {
  const router = useRouter(); const [reason, setReason] = useState(""); const [category, setCategory] = useState<(typeof CATEGORIES)[number]["key"]>("other");
  const [selected, setSelected] = useState<Evidence[]>([]); const [space, setSpace] = useState<SpaceSnapshot | null>(null); const [withoutMessage, setWithoutMessage] = useState(false);
  const [destination, setDestination] = useState<"platform" | "local" | "">(localDestination ? "" : "platform");
  const [leave, setLeave] = useState(false); const [preview, setPreview] = useState(false); const [error, setError] = useState(""); const [saved, setSaved] = useState<{ id?: string; duplicate?: boolean } | null>(null); const [pending, start] = useTransition();
  const recipient = destination === "local" ? localDestination === "group" ? "Group admins" : "Community moderators" : "AGENTME";
  if (saved) return <div className="space-y-3 p-3 text-sm" role="status"><p>{saved.duplicate ? "You already submitted this report." : `Your report was sent to ${recipient}.`}</p>{saved.id && <Link href={`/reports/${saved.id}`} className="font-medium text-accent underline">View report {saved.id.slice(0, 8).toUpperCase()} →</Link>}<button type="button" className="btn-ghost" onClick={onClose}>Done</button></div>;
  const canPreview = Boolean(reason.trim() && destination && (kind === "message" ? selected.some((m) => m.id === target) : space && (selected.length || withoutMessage)));
  return <div className="w-full space-y-3 rounded-xl border border-border p-4" role="region" aria-label={`Report ${kind}`}>
    <h2 className="font-semibold">{preview ? "Review your report" : kind === "message" ? "Report this message" : `Report this ${kind} to AGENTME`}</h2>
    <p className="text-xs text-muted">{destination === "local" ? "Local admins or moderators review this report under the space’s rules." : "AGENTME receives only the evidence you choose. Your report and identity are private from the reported person and local admins. A report does not automatically restrict anyone."}</p>
    {!preview ? <>
      {localDestination && <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Who should review it?</legend><label className="flex gap-2 text-sm"><input type="radio" name="report-destination" value="local" checked={destination === "local"} onChange={() => setDestination("local")} />Report to {localDestination === "group" ? "group admins" : "community moderators"}</label><label className="flex gap-2 text-sm"><input type="radio" name="report-destination" value="platform" checked={destination === "platform"} onChange={() => setDestination("platform")} />Report to AGENTME</label><p className="text-xs text-muted">Choose AGENTME for serious concerns or when local admins are involved. You can report directly without contacting them first.</p></fieldset>}
      <div className="text-sm"><label htmlFor="report-concern">Concern</label><select id="report-concern" className="input mt-1" value={category} onChange={(e) => setCategory(Category.parse(e.target.value))}>{CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></div>
      <div className="text-sm"><label htmlFor="report-description">What happened?</label><AutoGrowTextarea id="report-description" className="input mt-1" minRows={2} maxRows={6} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === "message" ? "Explain what is wrong with the message." : "Describe the concern, including the group’s purpose, admins or repeated behaviour."} /></div>
      <EvidencePicker kind={kind} target={target} selected={selected} onChange={setSelected} onSpace={setSpace} />
      {kind !== "message" && selected.length === 0 && <label className="flex gap-2 text-sm"><input type="checkbox" checked={withoutMessage} onChange={(e) => setWithoutMessage(e.target.checked)} />I don’t have a specific message; my explanation describes the concern.</label>}
      {canLeave && kind !== "message" && <label className="flex gap-2 text-sm"><input type="checkbox" checked={leave} onChange={(e) => setLeave(e.target.checked)} />{kind === "group" ? "Also leave and block this group" : "Also leave this community"}</label>}
      {kind !== "message" && !space && <p className="text-xs text-muted" role="status">Loading report information…</p>}
      <div className="flex gap-2"><button type="button" className="btn-primary" disabled={!canPreview} onClick={() => { setError(""); setPreview(true); }}>Review report</button><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button></div>
    </> : <>
      <p className="text-sm"><b>To:</b> {recipient} · {CATEGORIES.find((c) => c.key === category)?.label}</p><p className="whitespace-pre-wrap break-words text-sm">{reason}</p>
      {kind !== "message" && <div className="rounded-xl bg-accent-soft p-3 text-sm"><b>{space?.title ?? `Reported ${kind}`}</b>{space?.description && <p className="whitespace-pre-wrap">{space.description}</p>}{space?.rules && <p className="mt-2 whitespace-pre-wrap">{space.rules}</p>}<p className="mt-2 text-xs text-muted">The {kind}’s name, description and available rules are recorded with the report.</p></div>}
      <EvidenceList messages={selected} />{!selected.length && <p className="text-xs text-muted">No specific messages attached.</p>}
      <p className="text-xs text-muted">Only these selected messages are shared. Private agent conversations, attachments and location data are excluded.{leave && (kind === "group" ? " You will also leave and block the group." : " You will also leave the community.")}</p>
      <div className="flex gap-2"><button type="button" className="btn-danger" disabled={pending} onClick={() => start(async () => {
        setError(""); const input = { kind, target, category, reason, evidence: selected.map((m) => m.id), versions: evidenceVersions(selected) };
        try {
          const result = kind === "message" ? await submitMessageReport({ ...input, kind: "message", destination: destination === "local" ? "local" : "platform" }) : await submitPlatformReport(input, leave);
          if (result.error) { setError(result.error); return; }
          if ("left" in result && result.left && result.id) router.push(`/reports/${result.id}`);
          else { setSaved({ id: result.id, duplicate: "duplicate" in result && result.duplicate === true }); router.refresh(); }
        } catch { setError("Couldn't submit this report. Check your connection and try again."); }
      })}>{pending ? "Submitting…" : "Send report"}</button><button type="button" className="btn-ghost" disabled={pending} onClick={() => setPreview(false)}>Back</button><button type="button" className="btn-ghost" disabled={pending} onClick={onClose}>Cancel</button></div>
    </>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </div>;
}
