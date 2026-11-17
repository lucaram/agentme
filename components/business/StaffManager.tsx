"use client";
import { Avatar } from "@/components/Avatar";


import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeBusinessStaff, inviteBusinessStaff, cancelBusinessStaffInvite } from "@/app/(app)/business/staff-actions";
import { ChatDialog } from "@/components/chat/ChatDialog";
import { LocalTime } from "@/components/LocalTime";
import type { BusinessRole } from "@/lib/business/permissions";
import { WorkPresenceBadge } from "@/components/presence/WorkPresenceBadge";
import { StaffPicker } from "./StaffPicker";
import type { StaffSearchHit } from "@/app/(app)/business/staff-actions";
import { teamRoleLabel } from "@/lib/business/team-options";
import { StaffControls } from "./StaffControls";
import { DefaultReceivingOwner, StaffTransferControls } from "./TeamTransferControls";
import type { TeamTransfer } from "@/lib/business/team-types";

export type StaffMember = { id: string; name: string; handle: string | null; avatar: string; role: string; participating: boolean; topic: string; requireAssignment: boolean; requirePublicationApproval: boolean; supervisorId: string | null; supervisorName: string | null };
export type StaffInvite = { id: string; name: string; handle: string | null; avatar: string; role: string; status: string; expires_at: string; expired: boolean };
export function StaffManager({ members, invites, role, actorId, transfers = [], defaultOwner = null }: { members: StaffMember[]; invites: StaffInvite[]; role: BusinessRole; actorId: string; transfers?: TeamTransfer[]; defaultOwner?: string | null }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [error, setError] = useState(""); const [link, setLink] = useState(""); const [copied, setCopied] = useState(false);
  const [target, setTarget] = useState<StaffSearchHit | null>(null); const [invitedRole, setInvitedRole] = useState("staff"); const [roles, setRoles] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<{ member: StaffMember; role: string; transfer: boolean } | null>(null);
  const run = (action: () => Promise<{ error?: string; link?: string }>) => start(async () => {
    setError(""); setCopied(false);
    try { const result = await action(); if (result.error) setError(result.error); else { if (result.link) setLink(result.link); setConfirm(null); router.refresh(); } }
    catch { setError("Couldn't save this change. Please try again."); }
  });
  const canManage = role !== "staff";
  const ownControls = members.find((member) => member.id === actorId);
  const supervisors = members.filter((member) => member.role === "owner" || member.role === "manager").map((member) => ({ ...member, former: false }));
  return <div className="space-y-5" data-testid="staff-manager">
    <p className="text-sm text-muted">Your role: <b className="capitalize text-foreground">{role}</b>. Everyone uses their own login; personal chats stay separate.</p>
    {role === "staff" && <p className="hint">{ownControls?.requireAssignment ? "Customer requests must be assigned to you before you can reply." : "You can take unassigned customer requests."} {ownControls?.requirePublicationApproval !== false ? "Q&A suggestions need Owner or Manager approval." : "You can choose to publish eligible general answers after the publication check."}</p>}
    <ul className="divide-y divide-border" aria-label="Business team">{members.map((member) => {
      const editable = role === "owner" || role === "manager" && member.role === "staff" && member.supervisorId === actorId;
      return <li key={member.id} className="space-y-2 py-3"><div className="flex flex-wrap items-center gap-3"><span className="text-2xl" aria-hidden><Avatar value={member.avatar} /></span><span className="min-w-0 flex-1"><span className="block font-medium">{member.name}<span className="text-sm font-normal text-muted"> — {teamRoleLabel(member.role)}{member.id === actorId ? " (you)" : ""}</span></span>{member.role === "staff" && <span className="block text-xs text-muted">Reports to: {member.supervisorName ?? "Not assigned"}</span>}<WorkPresenceBadge topic={member.topic} participating={member.participating} self={member.id === actorId} /></span>
        {editable && <div className="flex flex-wrap items-center gap-2"><select className="input w-auto py-1 text-sm" aria-label={`Role for ${member.name}`} value={roles[member.id] ?? member.role} onChange={(event) => setRoles((old) => ({ ...old, [member.id]: event.target.value }))}>{role === "owner" && <><option value="owner">Owner</option><option value="manager">Manager</option></>}<option value="staff">Staff</option></select><button type="button" className="btn-ghost text-sm" disabled={pending || !roles[member.id] || roles[member.id] === member.role} onClick={() => setConfirm({ member, role: roles[member.id], transfer: false })}>Save role</button><button type="button" className="btn-ghost text-sm text-danger" disabled={pending} onClick={() => setConfirm({ member, role: "remove", transfer: false })}>Remove access</button></div>}
      </div>{role === "owner" && member.id !== actorId && <button type="button" className="text-xs text-accent underline" disabled={pending} onClick={() => setConfirm({ member, role: "owner", transfer: true })}>Transfer ownership to {member.name}</button>}{editable && member.role === "staff" && member.id !== actorId && <><StaffControls id={member.id} name={member.name} requireAssignment={member.requireAssignment} requirePublicationApproval={member.requirePublicationApproval} /><StaffTransferControls staffId={member.id} supervisorId={member.supervisorId} managers={supervisors} transfers={transfers} canCancel={(transfer) => role === "owner" || transfer.requested_by === actorId} /></>}</li>;
    })}</ul>
    {role === "owner" && <DefaultReceivingOwner owners={supervisors.filter((person) => person.role === "owner")} initial={defaultOwner} />}
    {canManage && <form className="space-y-3 border-t border-border pt-4" aria-label="Invite business staff" onSubmit={(event) => { event.preventDefault(); if (!target) return; run(async () => { const result = await inviteBusinessStaff(`@${target.handle}`, invitedRole); if (!result.error) setTarget(null); return result; }); }}>
      <h3 className="font-medium">Invite staff</h3>
      <StaffPicker selected={target} onPick={(person) => { setTarget(person); setLink(""); setError(""); }} disabled={pending} />
      <div className="flex flex-wrap items-center gap-2"><select className="input w-auto" aria-label="Invitation role" disabled={pending} value={invitedRole} onChange={(e) => setInvitedRole(e.target.value)}><option value="staff">Staff</option>{role === "owner" && <option value="manager">Manager</option>}</select><button className="btn-primary" disabled={pending || !target}>Create invitation</button></div>
      <p className="hint">Choose a registered user. Their invitation appears in My Agent. Private invitation links expire in seven days.</p>
    </form>}
    {link && <div className="space-y-2 rounded-xl border border-accent bg-accent-soft p-3"><p className="text-sm font-medium">Invitation ready to share</p><input className="input text-xs" aria-label="Staff invitation link" readOnly value={link} /><button type="button" className="btn-ghost text-sm" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setError("Copy the invitation link from the field above."); } }}>{copied ? "Copied" : "Copy invitation link"}</button></div>}
    {canManage && invites.length > 0 && <div className="space-y-2"><h3 className="font-medium">Invitations</h3><ul className="divide-y divide-border">{invites.map((invite) => <li key={invite.id} className="flex flex-wrap items-center gap-2 py-2"><span className="text-xl" aria-hidden><Avatar value={invite.avatar} /></span><span className="min-w-0 flex-1 break-words text-sm"><b>{invite.name}</b>{invite.handle && <span className="block text-xs text-muted">@{invite.handle}</span>}<span className="block text-xs capitalize text-muted">{invite.role} · {invite.status === "pending" && invite.expired ? "Expired" : invite.status}</span></span>{invite.status === "pending" && <>{invite.handle && <button type="button" className="btn-ghost text-sm" disabled={pending} onClick={() => run(() => inviteBusinessStaff("", invite.role, invite.id))}>New invitation link</button>}<button type="button" className="btn-ghost text-sm" disabled={pending} onClick={() => run(() => cancelBusinessStaffInvite(invite.id))}>Cancel invitation</button></>}</li>)}</ul></div>}
    {transfers.length > 0 && <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm font-medium">Transfer history</summary><ul className="mt-3 divide-y divide-border">{transfers.map((transfer) => <li key={transfer.id} className="py-2 text-sm"><b>{transfer.staff_name}</b>: {transfer.from_name} to {transfer.to_name}<span className="block text-xs capitalize text-muted">{transfer.status} <LocalTime iso={transfer.decided_at ?? transfer.created_at} /></span></li>)}</ul></details>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {confirm && <ChatDialog label={confirm.transfer ? "Transfer business ownership" : confirm.role === "remove" ? "Remove business access" : "Change business role"} onClose={() => { if (!pending) setConfirm(null); }}><div className="space-y-4 p-5"><h3 className="font-semibold">{confirm.transfer ? "Transfer ownership" : confirm.role === "remove" ? "Remove access" : "Change role"}</h3><p className="text-sm">{confirm.transfer ? `${confirm.member.name} becomes an owner. Your role changes to Manager.` : confirm.role === "remove" ? `${confirm.member.name} loses access to this business on every device. Their personal account stays intact.` : `${confirm.member.name}'s role changes to ${confirm.role}.`}</p><div className="flex gap-2"><button type="button" className="btn-primary" disabled={pending} onClick={() => run(() => changeBusinessStaff(confirm.member.id, confirm.role, confirm.transfer))}>Confirm change</button><button type="button" className="btn-ghost" disabled={pending} onClick={() => setConfirm(null)}>Cancel</button></div>{error && <p role="alert" className="text-sm text-danger">{error}</p>}</div></ChatDialog>}
  </div>;
}
export function StaffAudit({ rows }: { rows: { id: string; actor_name: string; subject_name: string; action: string; created_at: string }[] }) {
  return <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm font-medium">Recent team changes</summary><ul className="mt-3 divide-y divide-border">{rows.map((row) => <li key={row.id} className="py-2 text-sm"><b>{row.actor_name}</b> · {row.action}<span className="block text-xs text-muted">{row.subject_name} · <LocalTime iso={row.created_at} /></span></li>)}</ul>{!rows.length && <p className="hint mt-2">No changes recorded yet.</p>}</details>;
}
