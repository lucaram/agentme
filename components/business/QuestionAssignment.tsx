"use client";

import { useState, useTransition } from "react";
import { claimBusinessQuestion } from "@/app/(app)/business/staff-actions";
import { LocalTime } from "@/components/LocalTime";
import { assignmentOptions, teamRoleLabel, type AssignmentMember } from "@/lib/business/team-options";
import type { BusinessRole } from "@/lib/business/permissions";

export type QuestionClaim = { assigned_to: string | null; assigned_name: string | null; claimed_at: string | null; manager_assigned?: boolean };
export function QuestionAssignment({ id, actor, claim, role, members, assignmentRequired = false }: { id: string; actor: string; claim?: QuestionClaim; role: BusinessRole | null | undefined; members: AssignmentMember[]; assignmentRequired?: boolean }) {
  const canAssign = role === "owner" || role === "manager";
  const choices = assignmentOptions(members, actor, role);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const run = (assignee?: string, release = false) => start(async () => {
    setError(undefined);
    try { const result = await claimBusinessQuestion(id, assignee, release); setError(result.error); }
    catch { setError("Couldn't update assignment. Please try again."); }
  });
  return <div className="rounded-xl border border-border p-3 text-sm space-y-2">
    <p>{claim?.assigned_to ? <><b>{claim.assigned_name ?? "Team member"}</b> is handling this{claim.claimed_at && <> · <LocalTime iso={claim.claimed_at} /></>}</> : "Available for the team"}</p>
    <div className="flex flex-wrap gap-2 items-center">
      {!claim?.assigned_to && !assignmentRequired && <button className="btn-ghost" disabled={pending} onClick={() => run(actor)}>I&apos;ll handle this</button>}
      {claim?.assigned_to && (claim.assigned_to === actor || canAssign) && <button className="btn-ghost" disabled={pending} onClick={() => run(undefined, true)}>Release</button>}
      {choices.length > 0 && <select aria-label="Assign customer question" className="input w-auto" disabled={pending} value="" onChange={(e) => { if (e.target.value) run(e.target.value); }}><option value="">Assign to…</option>{choices.map((member) => <option key={member.id} value={member.id}>{member.name} — {teamRoleLabel(member.role)}</option>)}</select>}
    </div>
    {assignmentRequired && (claim?.assigned_to !== actor || !claim.manager_assigned) && <p className="text-xs text-muted">An Owner or Manager must assign this request to you before you can reply.</p>}
    {error && <p className="text-danger" role="alert">{error}</p>}
  </div>;
}
