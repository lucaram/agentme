"use client";

import { useState, useTransition } from "react";
import { requestReportEvidence, answerReportEvidence } from "@/app/(app)/platform-actions";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";
import { EvidencePicker, evidenceVersions } from "./EvidencePicker";
import { EvidenceList } from "./EvidenceList";
import type { Evidence, TargetKind } from "@/lib/moderation/types";

export function RequestEvidenceForm({ report, revision }: { report: string; revision: number }) {
  const [open, setOpen] = useState(false); const [question, setQuestion] = useState(""); const [error, setError] = useState(""); const [pending, start] = useTransition();
  if (!open) return <button type="button" className="btn-ghost" onClick={() => setOpen(true)}>Request more evidence</button>;
  return <form className="space-y-2 rounded-xl border border-border p-3" aria-label="Request more evidence" onSubmit={(event) => {
    event.preventDefault(); start(async () => { setError(""); try { const result = await requestReportEvidence(report, revision, question); if (result.error) setError(result.error); else { setQuestion(""); setOpen(false); } } catch { setError("Couldn't send the request. Please try again."); } });
  }}><label className="block text-sm">What should the reporter provide?<AutoGrowTextarea className="input mt-1" minRows={2} maxRows={5} minLength={5} maxLength={500} value={question} onChange={(e) => setQuestion(e.target.value)} required /></label><p className="text-xs text-muted">Sent privately through the reporter’s My Agent. They choose which additional messages to share.</p><div className="flex gap-2"><button className="btn-primary" disabled={pending}>{pending ? "Sending…" : "Send request"}</button><button type="button" className="btn-ghost" disabled={pending} onClick={() => setOpen(false)}>Cancel</button></div>{error && <p role="alert" className="text-sm text-danger">{error}</p>}</form>;
}

export function AnswerEvidenceForm({ request, kind, target }: { request: string; kind: TargetKind; target?: string }) {
  const [reply, setReply] = useState(""); const [selected, setSelected] = useState<Evidence[]>([]); const [preview, setPreview] = useState(false); const [error, setError] = useState(""); const [pending, start] = useTransition();
  return <section className="space-y-3" aria-label="Reply with more evidence">
    {!preview ? <><label className="block text-sm">Your explanation<AutoGrowTextarea className="input mt-1" minRows={2} maxRows={6} maxLength={2000} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Add specific examples, or explain why no further evidence is available." /></label>
      {target && <EvidencePicker kind={kind} target={target} selected={selected} onChange={setSelected} requirePrimary={false} />}
      <button type="button" className="btn-primary" disabled={!reply.trim()} onClick={() => setPreview(true)}>Review reply</button></> : <>
      <p className="text-sm font-medium">Additional information shared with AGENTME</p><p className="whitespace-pre-wrap break-words text-sm">{reply}</p><EvidenceList messages={selected} /><p className="text-xs text-muted">Only the messages above are shared. You can reply without attaching messages, including after leaving the space.</p>
      <div className="flex gap-2"><button type="button" className="btn-primary" disabled={pending} onClick={() => start(async () => {
        setError(""); try { const result = await answerReportEvidence({ request, reply, evidence: selected.map((m) => m.id), versions: evidenceVersions(selected) }); if (result.error) setError(result.error); } catch { setError("Couldn't send your reply. Please try again."); }
      })}>{pending ? "Sending…" : "Send evidence reply"}</button><button type="button" className="btn-ghost" disabled={pending} onClick={() => setPreview(false)}>Back</button></div>
    </>}{error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </section>;
}
