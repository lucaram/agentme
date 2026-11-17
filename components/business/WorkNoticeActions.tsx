"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acknowledgeBusinessWorkNotice, respondStaffTransfer } from "@/app/(app)/business/staff-actions";

export function WorkNoticeActions({ id, transferId }: { id: string; transferId: string | null }) {
  const [pending, start] = useTransition(); const [error, setError] = useState(""); const [done, setDone] = useState(false); const router = useRouter();
  const run = (decision?: string) => start(async () => { setError(""); try { const result = transferId && decision ? await respondStaffTransfer(transferId, decision) : await acknowledgeBusinessWorkNotice(id); if (result.error) setError(result.error); else { setDone(true); router.refresh(); } } catch { setError("Couldn't save your choice. Please try again."); } });
  return done ? <p role="status" className="mt-2 text-sm text-accent">Your choice is saved.</p> : <div className="mt-3 space-y-2"><div className="flex flex-wrap gap-2">{transferId ? <><button type="button" className="btn-primary text-sm" disabled={pending} onClick={() => run("accept")}>Accept transfer</button><button type="button" className="btn-secondary text-sm" disabled={pending} onClick={() => run("decline")}>Decline transfer</button></> : <button type="button" className="btn-ghost text-sm" disabled={pending} onClick={() => run()}>Mark as read</button>}</div>{error && <p role="alert" className="text-sm text-danger">{error}</p>}</div>;
}
