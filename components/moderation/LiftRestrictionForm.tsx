"use client";
import { useState, useTransition } from "react";
import { liftAccountRestriction } from "@/app/(app)/platform-actions";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";

export function LiftRestrictionForm({ id }: { id: string }) {
  const [reason, setReason] = useState(""); const [error, setError] = useState(""); const [pending, start] = useTransition();
  return <details className="mt-3"><summary className="cursor-pointer text-sm text-accent">Lift account restriction</summary><form className="mt-3 space-y-2" aria-label="Lift account restriction" onSubmit={(e) => {
    e.preventDefault(); if (!window.confirm("Lift this account restriction? Other active restrictions, if any, still apply.")) return;
    start(async () => { setError(""); try { const result = await liftAccountRestriction(id, reason); if (result.error) setError(result.error); } catch { setError("Couldn't lift this restriction. Please try again."); } });
  }}><label htmlFor={`lift-${id}`} className="block text-sm">Justification for lifting</label><AutoGrowTextarea id={`lift-${id}`} className="input" minRows={2} maxRows={5} minLength={5} maxLength={500} required value={reason} onChange={(e) => setReason(e.target.value)} /><button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Lift restriction"}</button>{error && <p role="alert" className="text-sm text-danger">{error}</p>}</form></details>;
}
