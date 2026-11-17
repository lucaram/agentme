"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestStaffTransfer, respondStaffTransfer, saveDefaultReceivingOwner } from "@/app/(app)/business/staff-actions";
import { MemberPicker } from "./MemberPicker";
import { LocalTime } from "@/components/LocalTime";
import type { TeamOption, TeamTransfer } from "@/lib/business/team-types";

export function StaffTransferControls({ staffId, supervisorId, managers, transfers, canCancel }: { staffId: string; supervisorId: string | null; managers: TeamOption[]; transfers: TeamTransfer[]; canCancel: (transfer: TeamTransfer) => boolean }) {
  const [target, setTarget] = useState(""); const [pending, start] = useTransition(); const [error, setError] = useState(""); const router = useRouter();
  const transfer = transfers.find((item) => item.staff_id === staffId && item.status === "pending");
  const run = (work: () => Promise<{ error?: string }>) => start(async () => { setError(""); try { const result = await work(); if (result.error) setError(result.error); else { setTarget(""); router.refresh(); } } catch { setError("Couldn't update this transfer. Please try again."); } });
  if (transfer) return <div className="mt-2 rounded-xl border border-accent/40 bg-accent-soft/30 p-3 text-sm" data-testid="pending-staff-transfer"><b>Move to {transfer.to_name}</b><p className="hint">Awaiting acceptance · requested by {transfer.requester_name}</p><p className="hint">Expires <LocalTime iso={transfer.expires_at} /></p>{canCancel(transfer) && <button type="button" className="btn-ghost mt-2 text-sm" disabled={pending} onClick={() => run(() => respondStaffTransfer(transfer.id, "cancel"))}>Cancel transfer</button>}{error && <p role="alert" className="text-danger">{error}</p>}</div>;
  return <details className="mt-2 rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm font-medium">Move Staff to another supervisor</summary><form className="mt-3 space-y-3" aria-label="Request Staff transfer" onSubmit={(event) => { event.preventDefault(); if (target) run(() => requestStaffTransfer(staffId, target)); }}><p className="hint">The receiving Owner or Manager must accept in My Agent. The current reporting line stays in place until then.</p><MemberPicker label="Receiving supervisor" options={managers.filter((person) => person.id !== supervisorId)} value={target} onChange={setTarget} disabled={pending} /><button className="btn-primary text-sm" disabled={pending || !target}>Request transfer</button>{error && <p role="alert" className="text-sm text-danger">{error}</p>}</form></details>;
}

export function DefaultReceivingOwner({ owners, initial }: { owners: TeamOption[]; initial: string | null }) {
  const [value, setValue] = useState(initial ?? ""); const [pending, start] = useTransition(); const [message, setMessage] = useState("");
  return <form className="space-y-2 rounded-xl border border-border p-3" aria-label="Default receiving Owner" onSubmit={(event) => { event.preventDefault(); start(async () => { try { const result = await saveDefaultReceivingOwner(value); setMessage(result.error ?? "Default receiving Owner saved."); } catch { setMessage("Couldn't save the receiving Owner."); } }); }}><label className="text-sm font-medium" htmlFor="default-receiving-owner">Default receiving Owner</label><p className="hint">If a supervisor leaves their role, their Staff automatically report to this Owner.</p><div className="flex flex-wrap items-center gap-2"><select id="default-receiving-owner" className="input min-w-0 flex-1" value={value} disabled={pending} onChange={(event) => setValue(event.target.value)}>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}{owner.handle ? ` (@${owner.handle})` : ""}</option>)}</select><button className="btn-secondary text-sm" disabled={pending || !value}>Save Owner</button></div>{message && <p role="status" className="hint">{message}</p>}</form>;
}
