import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionButton } from "@/components/ActionButton";
import { ConfirmButton, JoinLinkBox, MemberPicker, ReportForm } from "@/components/social/Controls";
import { LocalTime } from "@/components/LocalTime";
import { GROUP_AVATARS, MAX_GROUP_PEOPLE } from "@/lib/social/shared";
import { leaveConversation } from "../../actions";
import {
  addBusinessToGroupAction,
  addMembersAction,
  blockGroupAction,
  decideRequestAction,
  deleteGroupAction,
  dismissReportAction,
  groupLinkAction,
  removeBusinessFromGroupAction,
  removeMemberAction,
  removeMessageAction,
  reportGroupAction,
  searchBusinessesAction,
  revokeGroupLinkAction,
  setGroupRoleAction,
  setMutedAction,
} from "../../social-actions";
import { GroupInfoForm, GroupSettings } from "./GroupForms";
import { BusinessHandleForm } from "@/components/social/BusinessHandleForm";

const ROLE_LABEL = { owner: "Owner", admin: "Admin", member: "" } as const;

export default async function GroupPage({ params }: PageProps<"/groups/[id]">) {
  const { id } = await params;
  const { user, agent } = await requireAgent();
  const supabase = await createClient();
  // RLS: members only.
  const { data: group } = await supabase.from("conversations").select("*").eq("id", id).eq("kind", "group").maybeSingle();
  if (!group) notFound();
  const [{ data: members }, { data: agents }, { data: contacts }, { data: placements }] = await Promise.all([
    supabase.from("conversation_members").select("user_id, role, muted, joined_at").eq("conversation_id", id),
    supabase.from("agents").select("id, owner_id, handle, display_name, avatar, type"),
    supabase.from("contacts").select("requester_agent, addressee_agent").eq("status", "accepted"),
    supabase.from("business_placements").select("business_agent_id").eq("conversation_id", id).order("created_at"),
  ]);
  const me = (members ?? []).find((m) => m.user_id === user.id);
  if (!me) notFound();
  const isAdmin = me.role === "owner" || me.role === "admin";
  const canEdit = isAdmin || !group.only_admins_edit;
  const byOwner = new Map((agents ?? []).map((a) => [a.owner_id, a]));
  const byId = new Map((agents ?? []).map((a) => [a.id, a]));
  const memberIds = new Set((members ?? []).map((m) => m.user_id));
  const addable = (contacts ?? [])
    .map((c) => byId.get(c.requester_agent === agent.id ? c.addressee_agent : c.requester_agent))
    // Businesses are added below as businesses, never as members.
    .filter((a) => a !== undefined && a.type !== "business" && !memberIds.has(a.owner_id))
    .map((a) => a!);
  const businesses = (placements ?? []).map((p) => byId.get(p.business_agent_id)).filter((a) => a !== undefined);
  const sorted = [...(members ?? [])].sort(
    (a, b) => ["owner", "admin", "member"].indexOf(a.role) - ["owner", "admin", "member"].indexOf(b.role) || (byOwner.get(a.user_id)?.display_name ?? "").localeCompare(byOwner.get(b.user_id)?.display_name ?? ""),
  );

  // Admin queues (RLS lets only admins read them).
  const [{ data: requests }, { data: reports }] = isAdmin
    ? await Promise.all([
        supabase.from("join_requests").select("id, user_id, created_at").eq("conversation_id", id).eq("status", "pending").order("created_at"),
        supabase.from("reports").select("id, message_id, excerpt, reason, created_at").eq("conversation_id", id).eq("status", "open").not("message_id", "is", null).order("created_at", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }];

  return (
    <div className="space-y-6">
      <Link href="/groups" className="text-sm text-accent">‹ Groups</Link>
      <section className="card flex flex-wrap items-center gap-4">
        <span className="text-5xl">{group.avatar ?? "👥"}</span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">{group.title ?? "Group"}</h1>
          {group.description && <p className="text-sm text-muted">{group.description}</p>}
          <p className="text-xs text-muted">
            {members?.length} of {MAX_GROUP_PEOPLE} members{ROLE_LABEL[me.role as keyof typeof ROLE_LABEL] && ` · You're ${ROLE_LABEL[me.role as keyof typeof ROLE_LABEL].toLowerCase()}`}
            {group.only_admins_send && " · Only admins send"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/chats/${id}`} className="btn-primary">Open chat</Link>
          <ActionButton action={setMutedAction.bind(null, id, !me.muted)} label={me.muted ? "🔔 Unmute" : "🔕 Mute"} />
        </div>
      </section>

      {canEdit && (
        <details className="card">
          <summary className="cursor-pointer font-semibold">Edit group info</summary>
          <div className="mt-3">
            <GroupInfoForm groupId={id} title={group.title ?? ""} description={group.description ?? ""} avatar={group.avatar} avatars={GROUP_AVATARS} />
          </div>
        </details>
      )}

      <section className="card space-y-3" aria-label="Members">
        <h2 className="font-semibold">Members</h2>
        <ul className="divide-y divide-border">
          {sorted.map((m) => {
            const a = byOwner.get(m.user_id);
            const isMe = m.user_id === user.id;
            return (
              <li key={m.user_id} className="flex flex-wrap items-center gap-3 py-2" data-testid="group-member">
                <span className="text-xl">{a?.avatar}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {isMe ? "You" : a?.display_name}
                    {ROLE_LABEL[m.role as keyof typeof ROLE_LABEL] && (
                      <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent">{ROLE_LABEL[m.role as keyof typeof ROLE_LABEL]}</span>
                    )}
                  </span>
                  <span className="block text-xs text-muted">@{a?.handle}</span>
                </span>
                {isAdmin && !isMe && m.role !== "owner" && (
                  <span className="flex flex-wrap gap-1">
                    {m.role === "admin" ? (
                      <ActionButton action={setGroupRoleAction.bind(null, id, m.user_id, "member")} label="Dismiss as admin" />
                    ) : (
                      <ActionButton action={setGroupRoleAction.bind(null, id, m.user_id, "admin")} label="Make admin" />
                    )}
                    <ActionButton action={removeMemberAction.bind(null, id, m.user_id)} label="Remove" variant="btn-danger" />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {isAdmin && (
          <details>
            <summary className="cursor-pointer text-sm font-medium text-accent">＋ Add people</summary>
            <div className="mt-2">
              <MemberPicker people={addable} action={addMembersAction.bind(null, id)} />
            </div>
          </details>
        )}
      </section>

      <section className="card space-y-3" aria-label="Businesses">
        <div>
          <h2 className="font-semibold">Businesses</h2>
          <p className="hint">
            Mention a business in the chat (e.g. @{businesses[0]?.handle ?? "trattoria"}) to ask it something. It only sees messages that mention it,
            answers from its public information and never posts on its own. Anyone in the group can remove it.
          </p>
        </div>
        {businesses.length > 0 && (
          <ul className="divide-y divide-border">
            {businesses.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 py-2" data-testid="group-business">
                <span className="text-xl">{b.avatar}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{b.display_name}</span>
                  <span className="block text-xs text-muted">@{b.handle} · Business</span>
                </span>
                <ActionButton action={removeBusinessFromGroupAction.bind(null, id, b.id)} label="Remove" />
              </li>
            ))}
          </ul>
        )}
        {isAdmin ? (
          <details>
            <summary className="cursor-pointer text-sm font-medium text-accent">＋ Add a business</summary>
            <div className="mt-2">
              <BusinessHandleForm
                action={addBusinessToGroupAction.bind(null, id)}
                search={searchBusinessesAction}
                exclude={businesses.map((b) => b.id)}
                button="Add"
                done="added. Mention it in the chat to ask it something."
              />
            </div>
          </details>
        ) : (
          businesses.length === 0 && <p className="text-sm text-muted">No businesses yet. Group admins can add one.</p>
        )}
      </section>

      {isAdmin && (
        <section className="card space-y-4" aria-label="Admin settings">
          <h2 className="font-semibold">Admin settings</h2>
          <GroupSettings groupId={id} initial={{ only_admins_send: group.only_admins_send, only_admins_edit: group.only_admins_edit, approve_new_members: group.approve_new_members }} />
          <JoinLinkBox create={groupLinkAction.bind(null, id)} revoke={revokeGroupLinkAction.bind(null, id)} what={`“${group.title}”`} />
          {requests && requests.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-semibold">Asking to join</h3>
              <ul className="divide-y divide-border">
                {requests.map((r) => {
                  const a = byOwner.get(r.user_id);
                  return (
                    <li key={r.id} className="flex flex-wrap items-center gap-2 py-2" data-testid="join-request">
                      <span className="flex-1 text-sm">{a?.avatar} {a?.display_name} <span className="text-muted">@{a?.handle}</span></span>
                      <ActionButton action={decideRequestAction.bind(null, r.id, true)} label="Let in" variant="btn-primary" />
                      <ActionButton action={decideRequestAction.bind(null, r.id, false)} label="Decline" />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {reports && reports.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-semibold">Reported messages</h3>
              <ul className="divide-y divide-border">
                {reports.map((r) => (
                  <li key={r.id} className="space-y-1 py-2" data-testid="report">
                    <p className="rounded-lg bg-accent-soft px-2 py-1 text-sm">“{r.excerpt}”</p>
                    <p className="text-xs text-muted">Reason: {r.reason} · <LocalTime iso={r.created_at} /></p>
                    <span className="flex gap-2">
                      {r.message_id && <ActionButton action={removeMessageAction.bind(null, r.message_id, id)} label="Remove message" variant="btn-danger" />}
                      <ActionButton action={dismissReportAction.bind(null, r.id, `/groups/${id}`)} label="Dismiss" />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="card flex flex-wrap items-start gap-2" aria-label="Leave or report">
        <form action={leaveConversation.bind(null, id)}>
          <button className="btn-ghost">Leave group</button>
        </form>
        <ConfirmButton action={blockGroupAction.bind(null, id)} label="Block group" question="Leave this group and stop anyone adding you back?" variant="btn-ghost" />
        <ReportForm action={reportGroupAction.bind(null, id)} withLeave label="Report group" />
        {me.role === "owner" && (
          <ConfirmButton action={deleteGroupAction.bind(null, id)} label="Delete group" question="Delete this group and all its messages for everyone? This can't be undone." />
        )}
      </section>
    </div>
  );
}
