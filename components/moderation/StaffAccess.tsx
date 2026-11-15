"use client";

import { useState, useTransition } from "react";
import { grantReviewer, revokeReviewer, type StaffResult } from "@/app/(app)/moderation/staff/actions";

export function GrantReviewerForm() {
  const [email, setEmail] = useState(""); const [result, setResult] = useState<StaffResult>({}); const [pending, start] = useTransition();
  return <form className="card space-y-3" aria-label="Grant reviewer access" onSubmit={(event) => {
    event.preventDefault(); setResult({});
    start(async () => { try { const next = await grantReviewer(email); setResult(next); if (!next.error) setEmail(""); } catch { setResult({ error: "Couldn't change access. Check your connection and try again." }); } });
  }}>
    <h2 className="font-semibold">Add a reviewer</h2><p className="text-sm text-muted">Enter the email of a registered, verified personal account. New reviewers finish their AGENTME profile before reviewing reports.</p>
    <label className="block text-sm" htmlFor="reviewer-email">Account email</label>
    <div className="flex flex-wrap gap-2"><input id="reviewer-email" className="input min-w-0 flex-1" type="email" autoComplete="off" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="reviewer@example.com" disabled={pending} /><button className="btn-primary" disabled={pending}>{pending ? "Granting…" : "Grant access"}</button></div>
    {result.error && <p role="alert" className="text-sm text-danger">{result.error}</p>}{result.message && <p role="status" className="text-sm text-accent">{result.message}</p>}
  </form>;
}

export function RevokeReviewerButton({ id, email }: { id: string; email: string }) {
  const [result, setResult] = useState<StaffResult>({}); const [pending, start] = useTransition();
  return <div className="space-y-1"><button type="button" className="btn-danger" disabled={pending} onClick={() => {
    if (!window.confirm(`Remove platform reviewer access for ${email}?`)) return;
    setResult({}); start(async () => { try { setResult(await revokeReviewer(id)); } catch { setResult({ error: "Couldn't remove access. Check your connection and try again." }); } });
  }}>{pending ? "Removing…" : "Remove access"}</button>{result.error && <p role="alert" className="max-w-64 text-xs text-danger">{result.error}</p>}</div>;
}
