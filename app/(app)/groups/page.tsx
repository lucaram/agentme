import Link from "next/link";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { GROUP_AVATARS } from "@/lib/social/shared";
import { CreateGroupForm } from "./CreateGroupForm";
import { OpenRequests } from "@/components/requests/OpenRequests";
import { Notices } from "@/components/social/Notices";

const ROLE_LABEL = { owner: "Owner", admin: "Admin", member: "" } as const;

export default async function GroupsPage() {
  const { user, agent } = await requireAgent();
  const supabase = await createClient();
  // RLS: only groups the user is in.
  const [{ data: groups }, { data: mine }, { data: contacts }, { data: agents }] = await Promise.all([
    supabase.from("conversations").select("id, title, avatar, description, conversation_members(user_id)").eq("kind", "group").order("created_at", { ascending: false }),
    supabase.from("conversation_members").select("conversation_id, role, muted").eq("user_id", user.id),
    supabase.from("contacts").select("requester_agent, addressee_agent").eq("status", "accepted"),
    supabase.from("agents").select("id, handle, display_name, avatar"),
  ]);
  const myRow = new Map((mine ?? []).map((m) => [m.conversation_id, m]));
  // What admins have to review, per group (RLS: only groups where you're owner/admin).
  const [{ data: pendingRequests }, { data: openReports }] = await Promise.all([
    supabase.from("join_requests").select("conversation_id").eq("status", "pending").not("conversation_id", "is", null),
    supabase.from("reports").select("conversation_id").eq("status", "open").is("community_id", null).not("message_id", "is", null),
  ]);
  const toReview = new Map<string, number>();
  for (const r of [...(pendingRequests ?? []), ...(openReports ?? [])]) {
    const role = r.conversation_id ? myRow.get(r.conversation_id)?.role : null;
    if (r.conversation_id && (role === "owner" || role === "admin")) toReview.set(r.conversation_id, (toReview.get(r.conversation_id) ?? 0) + 1);
  }
  const byId = new Map((agents ?? []).map((a) => [a.id, a]));
  const people = (contacts ?? [])
    .map((c) => byId.get(c.requester_agent === agent.id ? c.addressee_agent : c.requester_agent))
    .filter((a) => a !== undefined)
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Groups</h1>
          <p className="text-xs text-muted">Private chats with people you know. Admins manage members and settings.</p>
        </div>
      </div>
      <OpenRequests title="Group invites" kinds={["group_invite"]} />
      <Notices area="groups" />
      <CreateGroupForm contacts={people} avatars={GROUP_AVATARS} />

      {groups?.length ? (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {groups.map((g) => {
            const me = myRow.get(g.id);
            const role = (me?.role ?? "member") as keyof typeof ROLE_LABEL;
            return (
              <li key={g.id}>
                <Link href={`/groups/${g.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-accent-soft">
                  <span className="text-2xl">{g.avatar ?? "👥"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {g.title ?? "Group"} {me?.muted && <span title="Muted">🔕</span>}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {g.conversation_members.length} {g.conversation_members.length === 1 ? "member" : "members"}
                      {ROLE_LABEL[role] && ` · ${ROLE_LABEL[role]}`}
                      {g.description && ` · ${g.description}`}
                    </span>
                  </span>
                  {toReview.get(g.id) ? (
                    <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-white dark:text-black" data-testid="to-review">
                      {toReview.get(g.id)} to review
                    </span>
                  ) : null}
                  <span className="text-xs text-accent">Manage ›</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="card text-sm text-muted">No groups yet. Create one with your contacts.</p>
      )}
    </div>
  );
}
