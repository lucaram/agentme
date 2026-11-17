import { createClient } from "@/lib/supabase/server";
import { TeamState } from "@/lib/business/team-types";
import { requireBusinessPermission } from "@/lib/business/access";
import { adminClient } from "@/lib/supabase/admin";
import { StaffManager, StaffAudit } from "./StaffManager";

export async function StaffSection() {
  const { user, agent } = await requireBusinessPermission("read"); const db = adminClient(); const canManage = user.businessRole !== "staff"; const client = await createClient();
  const stateResult = await client.rpc("business_team_state"); const state = TeamState.safeParse(stateResult.data);
  if (stateResult.error || !state.success) return <p role="alert" className="text-sm text-muted">Staff &amp; access could not be loaded. Refresh to try again.</p>;
  const [{ data: memberships }, { data: availability }, { data: invites }, { data: audit }, { data: presence }] = await Promise.all([
    db.from("business_managers").select("user_id,role,require_assignment,require_publication_approval,supervisor_id").eq("business_agent_id", agent.id).order("created_at"),
    db.from("business_staff_availability").select("user_id,participating").eq("business_agent_id", agent.id),
    canManage ? db.from("business_staff_invites").select("id,recipient_user,invited_by,role,status,expires_at").eq("business_agent_id", agent.id).order("created_at", { ascending: false }).limit(50) : Promise.resolve({ data: [] }),
    canManage ? client.from("business_staff_audit").select("id,actor_name,subject_name,action,created_at").eq("business_agent_id", agent.id).order("created_at", { ascending: false }).limit(30) : Promise.resolve({ data: [] }),
    db.from("presence_preferences").select("generation").eq("agent_id", agent.id).single(),
  ]);
  const list = memberships?.length ? memberships : [{ user_id: agent.owner_id, role: "owner", supervisor_id: null, require_assignment: false, require_publication_approval: true }];
  const userIds = [...new Set([...list.map((m) => m.user_id), ...(invites ?? []).flatMap((invite) => invite.recipient_user ? [invite.recipient_user] : [])])];
  const { data: people } = await db.from("agents").select("owner_id,display_name,avatar,handle,type").in("owner_id", userIds);
  const members = list.map((membership) => { const person = people?.find((p) => p.owner_id === membership.user_id); return { id: membership.user_id, name: person?.display_name ?? "Team member", handle: person?.handle ?? null, avatar: person?.avatar ?? "👤", role: membership.role, supervisorId: membership.supervisor_id, supervisorName: people?.find((person) => person.owner_id === membership.supervisor_id)?.display_name ?? null, requireAssignment: membership.require_assignment, requirePublicationApproval: membership.require_publication_approval, participating: availability?.find((a) => a.user_id === membership.user_id)?.participating ?? membership.role === "owner", topic: `staff-presence:${agent.id}:${membership.user_id}:${presence?.generation}` }; });
  const invitations = (invites ?? []).filter((invite) => user.businessRole === "owner" || invite.role === "staff" && invite.invited_by === (user.actorId ?? user.id)).map((invite) => { const person = people?.find((person) => person.owner_id === invite.recipient_user && person.type === "personal"); return { id: invite.id, name: person?.display_name ?? "Unavailable account", handle: person?.handle ?? null, avatar: person?.avatar ?? "👤", role: invite.role, status: invite.status, expires_at: invite.expires_at, expired: Date.parse(invite.expires_at) <= new Date().getTime() }; });
  return <div className="space-y-5"><StaffManager members={members} invites={invitations} role={user.businessRole!} actorId={user.actorId ?? user.id} transfers={state.data.transfers} defaultOwner={state.data.defaultOwner} />{canManage && <StaffAudit rows={audit ?? []} />}</div>;
}
