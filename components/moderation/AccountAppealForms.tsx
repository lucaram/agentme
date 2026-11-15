"use client";
import { useState, useTransition } from "react";
import { submitAccountAppeal } from "@/app/account-status/actions";
import { reviewAccountAppeal } from "@/app/(app)/platform-actions";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";

export function AccountAppealForm({ id }: { id: string }) {
  const [reason, setReason] = useState(""); const [error, setError] = useState(""); const [pending, start] = useTransition();
  return <details><summary className="cursor-pointer font-medium text-accent">Appeal this decision</summary><form className="mt-3 space-y-3" aria-label="Account appeal" onSubmit={(e) => {
    e.preventDefault(); start(async () => { setError(""); try { const result = await submitAccountAppeal(id, reason); if (result.error) setError(result.error); } catch { setError("Couldn't submit your appeal. Please try again."); } });
  }}><label className="block text-sm" htmlFor={`appeal-${id}`}>Why should this decision be reconsidered?</label><AutoGrowTextarea id={`appeal-${id}`} className="input" minRows={3} maxRows={8} maxLength={2000} required value={reason} onChange={(e) => setReason(e.target.value)} /><p className="text-xs text-muted">A different, uninvolved platform reviewer will review your explanation.</p><button className="btn-primary" disabled={pending}>{pending ? "Sending…" : "Submit appeal"}</button>{error && <p role="alert" className="text-sm text-danger">{error}</p>}</form></details>;
}
export function ReviewAccountAppealForm({ id }: { id: string }) {
  const [accept, setAccept] = useState(true); const [response, setResponse] = useState(""); const [error, setError] = useState(""); const [pending, start] = useTransition();
  return <form className="space-y-3 border-t border-border pt-3" aria-label="Review account appeal" onSubmit={(e) => {
    e.preventDefault(); if (!window.confirm(accept ? "Accept this appeal and lift this restriction? Other restrictions, if any, still apply." : "Reject this appeal and keep the original decision?")) return;
    start(async () => { setError(""); try { const result = await reviewAccountAppeal(id, accept, response); if (result.error) setError(result.error); } catch { setError("Couldn't save the appeal decision. Please try again."); } });
  }}><div><label htmlFor={`appeal-action-${id}`} className="text-sm">Decision</label><select id={`appeal-action-${id}`} className="input mt-1" value={accept ? "accept" : "reject"} onChange={(e) => setAccept(e.target.value === "accept")}><option value="accept">Accept appeal and lift restriction</option><option value="reject">Reject appeal</option></select></div><label htmlFor={`appeal-response-${id}`} className="block text-sm">Justification sent to the account</label><AutoGrowTextarea id={`appeal-response-${id}`} className="input" minRows={2} maxRows={5} minLength={5} maxLength={500} required value={response} onChange={(e) => setResponse(e.target.value)} /><button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save appeal decision"}</button>{error && <p role="alert" className="text-sm text-danger">{error}</p>}</form>;
}
