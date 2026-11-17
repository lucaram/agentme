"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveBusinessStaffControls } from "@/app/(app)/business/staff-actions";

export function StaffControls({ id, name, requireAssignment, requirePublicationApproval }: { id: string; name: string; requireAssignment: boolean; requirePublicationApproval: boolean }) {
  const [assignment, setAssignment] = useState(requireAssignment); const [approval, setApproval] = useState(requirePublicationApproval);
  const [last, setLast] = useState({ requireAssignment, requirePublicationApproval });
  const [pending, start] = useTransition(); const [error, setError] = useState(""); const [saved, setSaved] = useState(false); const router = useRouter();
  if (last.requireAssignment !== requireAssignment || last.requirePublicationApproval !== requirePublicationApproval) { setLast({ requireAssignment, requirePublicationApproval }); setAssignment(requireAssignment); setApproval(requirePublicationApproval); }
  const controls = [
    { label: "Require assignment before replying", help: assignment ? "An Owner or Manager must assign each customer request first." : "Can take and answer an unassigned customer request.", value: assignment, change: setAssignment },
    { label: "Require approval before publishing to Q&A", help: approval ? "An Owner or Manager reviews suggested answers before publication." : "Can publish eligible general answers after the safety check. Adding to Q&A stays optional.", value: approval, change: setApproval },
  ];
  return <details className="mt-2 rounded-xl border border-border bg-background/40 p-3" data-testid="staff-controls"><summary className="cursor-pointer text-sm font-medium">Reply &amp; Q&amp;A permissions</summary><form className="mt-3 space-y-4" aria-label={`Permissions for ${name}`} onSubmit={(event) => { event.preventDefault(); start(async () => { setError(""); setSaved(false); try { const result = await saveBusinessStaffControls(id, assignment, approval); if (result.error) setError(result.error); else { setSaved(true); router.refresh(); } } catch { setError("Couldn't save permissions. Please try again."); } }); }}>
    {controls.map((control) => <label key={control.label} className="flex cursor-pointer items-start justify-between gap-4"><span className="min-w-0"><span className="block text-sm font-medium">{control.label}</span><span className="mt-1 block text-xs text-muted">{control.help}</span></span><span className="relative mt-0.5 inline-flex shrink-0"><input type="checkbox" role="switch" aria-label={control.label} checked={control.value} disabled={pending} onChange={(event) => { control.change(event.target.checked); setSaved(false); }} className="peer sr-only" /><span aria-hidden className="h-6 w-10 rounded-full bg-border transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2 after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-foreground after:transition-transform peer-checked:after:translate-x-4 peer-checked:after:bg-background" /></span></label>)}
    <p className="text-xs text-muted">These settings do not require approval for customer replies.</p>
    <div className="flex items-center gap-3"><button className="btn-primary text-sm" disabled={pending || assignment === requireAssignment && approval === requirePublicationApproval}>{pending ? "Saving…" : "Save permissions"}</button>{saved && <span role="status" className="text-xs text-accent">Permissions saved.</span>}</div>{error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </form></details>;
}
