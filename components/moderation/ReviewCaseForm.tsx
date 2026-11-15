"use client";
import { useState, useTransition } from "react";
import { reviewPlatformCase } from "@/app/(app)/platform-actions";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";
import { isAccountAction, type ReviewInput, type AccountPerson } from "@/lib/moderation/types";
import { ReportingHistory } from "./ReportingHistory";

export function ReviewCaseForm({ id, revision, closed, suspended, message = false, people = [], initialSubject }: { id: string; revision: number; closed: boolean; suspended: boolean; message?: boolean; people?: AccountPerson[]; initialSubject?: string | null }) {
  const [action, setAction] = useState<ReviewInput["action"]>(closed ? "restore" : "review"); const [response, setResponse] = useState(""); const [note, setNote] = useState(""); const [error, setError] = useState(""); const [pending, start] = useTransition();
  const [subject, setSubject] = useState(message ? people[0]?.id ?? "" : initialSubject ?? ""); const [evidence, setEvidence] = useState(message ? people[0]?.evidence[0]?.id ?? "" : "");
  const person = people.find((p) => p.id === subject); const accountAction = isAccountAction(action);
  return <div className="space-y-4">
    <section className="card space-y-3" aria-label="Reported account">
      {message ? <p className="text-sm font-medium">Reported account: {person?.name ?? "Account unavailable"}</p> : <><label htmlFor="case-account" className="block text-sm font-medium">Account to review</label><select id="case-account" className="input" value={subject} onChange={(e) => { setSubject(e.target.value); setEvidence(""); }}>{!initialSubject && <option value="">Choose an author from submitted evidence</option>}{people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.protected ? " · Protected operator" : ""}</option>)}</select><p className="text-xs text-muted">Account restrictions require a specific person and supporting evidence. Group ownership alone does not identify the person responsible.</p></>}
      {person ? <ReportingHistory key={person.id} caseId={id} subject={person.id} name={person.name} /> : <p className="text-xs text-muted">{people.length ? "Select an account to view its reporting history." : "No eligible account is identified by the submitted evidence. Request more evidence before restricting an account."}</p>}
      {person?.protected && <p className="text-xs text-muted">Platform operator accounts are protected from account restrictions here.</p>}
    </section>
    {(!closed || suspended) && <form className="card space-y-3" aria-label="Platform decision" onSubmit={(event) => {
      event.preventDefault();
      if (accountAction && (!person || !evidence)) { setError("Select the account and supporting evidence."); return; }
      if (action === "suspend" && !window.confirm("Suspend this space? Members can read existing messages, but cannot post or join until it is restored.")) return;
      if (action === "remove" && !window.confirm("Remove the reported message for everyone? Its submitted evidence remains in the case.")) return;
      if (accountAction && !window.confirm(`${action === "ban" ? "Permanently ban" : action === "suspend_1m" ? "Suspend for 1 month:" : "Suspend for 3 months:"} ${person?.name}’s AGENTME account? This affects the account across the app, including its agent. Your justification will be sent to them.`)) return;
      start(async () => { setError(""); try { const result = await reviewPlatformCase({ id, revision, action, response, note, ...(accountAction ? { subject, evidence } : {}) }); if (result.error) setError(result.error); } catch { setError("Couldn't save the decision. Check your connection and try again."); } });
    }}>
      <h2 className="font-semibold">Human review decision</h2>
      <div className="text-sm"><label htmlFor="platform-review-action">Action</label><select id="platform-review-action" className="input mt-1" value={action} onChange={(e) => setAction(e.target.value as ReviewInput["action"])} disabled={pending}>
        {!closed && <><option value="review">Start review</option><option value="dismiss">Close without action</option><option value="warn">{message ? "Warn message author" : "Warn space admins"}</option>{message ? <option value="remove">Remove reported message</option> : <option value="suspend">Suspend space</option>}
          <option value="suspend_1m" disabled={!person || person.protected}>Temporary account suspension — 1 month</option><option value="suspend_3m" disabled={!person || person.protected}>Temporary account suspension — 3 months</option><option value="ban" disabled={!person || person.protected}>Permanent ban</option>
        </>}{suspended && !message && <option value="restore">Restore space</option>}
      </select></div>
      {accountAction && !message && <div className="text-sm"><label htmlFor="account-action-evidence">Supporting message authored by {person?.name}</label><select id="account-action-evidence" className="input mt-1" value={evidence} onChange={(e) => setEvidence(e.target.value)} required><option value="">Select supporting evidence</option>{person?.evidence.map((m) => <option key={m.id} value={m.id}>{m.content.slice(0, 120)}</option>)}</select></div>}
      <div className="text-sm"><label htmlFor="platform-justification">Justification{action === "review" && " (optional while starting review)"}</label><AutoGrowTextarea id="platform-justification" className="input mt-1" value={response} onChange={(e) => setResponse(e.target.value)} minRows={2} maxRows={5} minLength={action === "review" ? undefined : 5} maxLength={500} required={action !== "review"} /><p className="text-xs text-muted">For final decisions, this is shared with affected users. Keep reporter identities and confidential evidence out.</p></div>
      <div className="text-sm"><label htmlFor="platform-internal-note">Internal review notes (optional)</label><AutoGrowTextarea id="platform-internal-note" className="input mt-1" value={note} onChange={(e) => setNote(e.target.value)} minRows={2} maxRows={5} maxLength={2000} /><p className="text-xs text-muted">Visible only to authorised platform reviewers.</p></div>
      <button className={accountAction || action === "suspend" || action === "remove" ? "btn-danger" : "btn-primary"} disabled={pending}>{pending ? "Saving…" : "Save decision"}</button>{error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </form>}
  </div>;
}
