"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { reportingHistory } from "@/app/(app)/platform-actions";
import { actionLabel, type ReportingHistoryEntry } from "@/lib/moderation/types";
import { LocalTime } from "@/components/LocalTime";

export function ReportingHistory({ caseId, subject, name }: { caseId: string; subject: string; name: string }) {
  const [rows, setRows] = useState<ReportingHistoryEntry[] | null>(null); const [page, setPage] = useState(0); const [error, setError] = useState(""); const [pending, start] = useTransition();
  const load = (offset: number) => start(async () => { setError(""); try { const result = await reportingHistory(caseId, subject, offset); if (result.error) setError(result.error); else { setRows(result.rows ?? []); setPage(offset); } } catch { setError("Couldn't load history. Please try again."); } });
  return <details className="rounded-xl border border-border p-3" onToggle={(event) => { if (event.currentTarget.open && rows === null && !pending && !error) load(0); }}><summary className="cursor-pointer text-sm font-semibold">Reporting history · {name}</summary><p className="mt-2 text-xs text-muted">Other reports sent to AGENTME. Pending and dismissed reports do not establish misconduct.</p>
    {pending && <p role="status" className="mt-2 text-xs text-muted">Loading history…</p>}{error && <div className="mt-2 text-sm"><p role="alert" className="text-danger">{error}</p><button type="button" className="btn-ghost mt-2" onClick={() => load(page)}>Retry</button></div>}
    {!pending && rows && !rows.length && <p className="mt-3 text-sm">No previous reports.</p>}
    {rows && rows.slice(0, 25).map((row) => <article key={row.id} className="mt-3 space-y-1 border-t border-border pt-3 text-sm" data-testid="reporting-history-entry"><p className="font-medium">{name}</p><p>Reported <LocalTime iso={row.reported_at} full /></p>{row.accessible ? <><p>Action: {actionLabel(row.action)}</p>{row.decided_at ? <p>Decision <LocalTime iso={row.decided_at} full /></p> : <p className="text-muted">{row.status === "closed" ? "Closed" : "Review pending"}</p>}{row.justification && <p className="whitespace-pre-wrap break-words">Justification: {row.justification}</p>}{row.expires_at && <p>Ends <LocalTime iso={row.expires_at} full /></p>}{row.restriction_status && <p className="text-xs text-muted">Restriction: {row.restriction_status}</p>}<Link className="text-xs text-accent underline" href={`/moderation/${row.id}`}>View case</Link></> : <p className="text-muted">Details are restricted because of your involvement in that case.</p>}</article>)}
    {rows && <div className="mt-3 flex gap-2">{page > 0 && <button type="button" className="btn-ghost" disabled={pending} onClick={() => load(page - 1)}>Previous</button>}{rows.length > 25 && <button type="button" className="btn-ghost" disabled={pending} onClick={() => load(page + 1)}>More history</button>}</div>}
  </details>;
}
