import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionButton } from "@/components/ActionButton";
import { ConfirmButton, JoinLinkBox } from "@/components/social/Controls";
import { LocalTime } from "@/components/LocalTime";
import { COMMUNITY_AVATARS, MAX_COMMUNITY_PEOPLE, daysAgo, stillMuted } from "@/lib/social/shared";
import {
  communityLinkAction,
  decideRequestAction,
  deleteCommunityAction,
  dismissReportAction,
  invitePartnerAction,
  leaveCommunityAction,
  muteMemberAction,
  removeFromCommunityAction,
  removeMessageAction,
  resolveAppealAction,
  removePartnerAction,
  revokeCommunityLinkAction,
  searchBusinessesAction,
  setCommunityRoleAction,
  setMutedAction,
  unbanAction,
} from "../../social-actions";
import { EditCommunityForm } from "../CommunityForm";
import { JoinCommunity } from "./JoinCommunity";
import { BusinessHandleForm } from "@/components/social/BusinessHandleForm";
import { Fold } from "@/components/Fold";
import { languageOf, rulesList } from "@/lib/social/rules";
import { digestCounts, suggestModerators, touchSeen } from "@/lib/social/digest";

const AUTOPILOT_ACTION: Record<string, string> = {
  refused: "Kept out",
  hidden_after_reports: "Hidden after reports",
  posted_after_nudge: "Posted after a nudge",
};

const ROLE_LABEL = { owner: "Owner", moderator: "Moderator", member: "" } as const;

export default async function CommunityPage({ params }: PageProps<"/communities/[id]">) {
  const { id } = await params;
  const { user } = await requireAgent();
  const supabase = await createClient();
  // RLS: public communities, or private ones you're in.
  const { data: community } = await supabase.from("communities").select("*").eq("id", id).maybeSingle();
  if (!community) notFound();
  const [{ data: me }, { data: counts }] = await Promise.all([
    supabase.from("community_members").select("role, muted_until").eq("community_id", id).eq("user_id", user.id).maybeSingle(),
    supabase.rpc("community_member_counts", { p_ids: [id] }),
  ]);
  const members = Number(counts?.[0]?.members ?? 0);
  // Official partners (RLS: active ones for anyone who can see the community; invitations for moderators).
  const { data: placementRows } = await supabase.from("business_placements").select("id, business_agent_id, status").eq("community_id", id).order("created_at");
  const { data: partnerAgents } = placementRows?.length
    ? await supabase.from("agents").select("id, handle, display_name, avatar").in("id", placementRows.map((p) => p.business_agent_id))
    : { data: [] };
  const partners = (placementRows ?? [])
    .map((p) => ({ ...p, agent: (partnerAgents ?? []).find((a) => a.id === p.business_agent_id) }))
    .filter((p): p is typeof p & { agent: NonNullable<typeof p.agent> } => Boolean(p.agent));
  const activePartners = partners.filter((p) => p.status === "active");
  const isMod = me?.role === "owner" || me?.role === "moderator";
  const isOwner = me?.role === "owner";

  const header = (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-5xl">{community.avatar}</span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">{community.name}</h1>
          <p className="text-xs text-muted">
            {members} of {MAX_COMMUNITY_PEOPLE.toLocaleString("en-GB")} members · {community.visibility === "private" ? "🔒 Private" : "Public"}
            {languageOf(community.language) && ` · ${languageOf(community.language)!.flag} ${languageOf(community.language)!.name}`}
            {me && ROLE_LABEL[me.role as keyof typeof ROLE_LABEL] && ` · You're ${ROLE_LABEL[me.role as keyof typeof ROLE_LABEL].toLowerCase()}`}
          </p>
        </div>
      </div>
      {community.description && <p className="text-sm">{community.description}</p>}
      {activePartners.length > 0 && (
        <div className="space-y-1" data-testid="community-partners">
          <p className="text-xs font-semibold text-muted">🤝 Official partners</p>
          <div className="flex flex-wrap gap-2">
            {activePartners.map((p) => (
              <Link key={p.id} href={`/u/${p.agent.handle}`} className="rounded-full bg-accent-soft px-3 py-1 text-sm hover:underline">
                {p.agent.avatar} {p.agent.display_name} <span className="text-muted">@{p.agent.handle}</span>
              </Link>
            ))}
          </div>
          {me && <p className="hint">Mention a partner in the chats to ask it something. It only sees messages that mention it and never posts on its own.</p>}
        </div>
      )}
      {/* Before joining, people see exactly what they accept: the core rules and the house rules. */}
      <details open={!me}>
        <summary className="cursor-pointer text-sm font-semibold">Rules</summary>
        <ul className="mt-1 space-y-1 rounded-lg bg-accent-soft px-3 py-2 text-sm" data-testid="community-rules">
          {rulesList(community.house_rules ?? [], community.language).map((r) => (
            <li key={r.id}>
              {r.icon} {r.label}
            </li>
          ))}
        </ul>
      </details>
      <p className="text-xs text-muted" data-testid="spam-protection">
        🛡️ Spam protection is on: new members can&apos;t post links for their first day, repeated messages and floods of links or mentions are
        blocked, and messages that look like selling are flagged to moderators.
      </p>
    </section>
  );

  if (!me) {
    const { data: pending } = await supabase.from("join_requests").select("id").eq("community_id", id).eq("user_id", user.id).eq("status", "pending").maybeSingle();
    return (
      <div className="space-y-6">
        <Link href="/communities" className="text-sm text-accent">‹ Communities</Link>
        {header}
        {pending ? (
          <p className="card text-sm text-muted">Request sent. A moderator will let you in.</p>
        ) : (
          <JoinCommunity id={id} hasRules isPrivate={community.visibility === "private"} />
        )}
      </div>
    );
  }

  const [{ data: channels }, { data: myChannelRows }] = await Promise.all([
    supabase.from("conversations").select("id, title, channel").eq("community_id", id).order("channel"),
    supabase.from("conversation_members").select("conversation_id, muted").eq("user_id", user.id),
  ]);
  const mutedChannels = new Set((myChannelRows ?? []).filter((r) => r.muted).map((r) => r.conversation_id));
  const ordered = [...(channels ?? [])].sort((a) => (a.channel === "announcements" ? -1 : 1));
  const mutedUntil = stillMuted(me.muted_until) ? me.muted_until : null;

  // Moderator tools (RLS lets only moderators read requests, reports and bans).
  const [{ data: people }, { data: agents }, { data: requests }, { data: reports }, { data: bans }] = isMod
    ? await Promise.all([
        supabase.from("community_members").select("user_id, role, muted_until, joined_at").eq("community_id", id).order("joined_at").limit(300),
        supabase.from("agents").select("owner_id, handle, display_name, avatar"),
        supabase.from("join_requests").select("id, user_id, created_at").eq("community_id", id).eq("status", "pending").order("created_at"),
        supabase.from("reports").select("id, message_id, conversation_id, excerpt, reason, created_at").eq("community_id", id).eq("status", "open").order("created_at", { ascending: false }),
        supabase.from("community_bans").select("user_id, reason, created_at").eq("community_id", id),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }];
  const byOwner = new Map((agents ?? []).map((a) => [a.owner_id, a]));
  // Autopilot (moderators only; RLS: moderation_events are for this community's moderators).
  if (me) await touchSeen(id, user.id);
  const weekAgo = daysAgo(7);
  const [autopilotWeek, { data: autopilotRows }, suggested] = isMod
    ? await Promise.all([
        digestCounts(id, weekAgo),
        supabase.from("moderation_events").select("id, action, verdict, excerpt, user_id, created_at, appeal_status, appealed_at").eq("community_id", id).gt("created_at", weekAgo).order("created_at", { ascending: false }).limit(50),
        // A couple of moderators is enough; otherwise suggest active members with a clean record.
        (people ?? []).filter((p) => p.role !== "member").length < 3 ? suggestModerators(id) : Promise.resolve([]),
      ])
    : [{ refused: 0, hidden: 0, nudged: 0, appeals: 0 }, { data: [] }, []];
  const appealsWaiting = (autopilotRows ?? []).filter((e) => e.appeal_status === "pending");
  const autopilotRecent = (autopilotRows ?? []).filter((e) => e.action !== "nudged").slice(0, 20);
  const who = (userId: string) => {
    const a = byOwner.get(userId);
    return a ? `${a.avatar} ${a.display_name} @${a.handle}` : "Someone";
  };

  return (
    <div className="space-y-6">
      <Link href="/communities" className="text-sm text-accent">‹ Communities</Link>
      {header}

      <section className="card space-y-2" aria-label="Chats">
        <h2 className="font-semibold">Chats</h2>
        {/* Each chat is a row you tap (highlighted on hover, like Settings); Mute stays separate. */}
        <ul className="space-y-2">
          {ordered.map((c) => (
            <li key={c.id} className="flex items-center gap-2 rounded-xl border border-border bg-background transition hover:border-accent/60 hover:bg-accent-soft">
              <Link href={`/chats/${c.id}`} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3" data-testid={`channel-${c.channel}`}>
                <span className="text-xl" aria-hidden>{c.channel === "announcements" ? "📣" : "💬"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{c.channel === "announcements" ? "Announcements" : "General"}</span>
                  <span className="block text-xs text-muted">{c.channel === "announcements" ? "Moderators post, everyone reads" : "Everyone can talk"}</span>
                </span>
                <span className="text-accent" aria-hidden>›</span>
              </Link>
              <span className="pr-3">
                <ActionButton action={setMutedAction.bind(null, c.id, !mutedChannels.has(c.id))} label={mutedChannels.has(c.id) ? "🔔 Unmute" : "🔕 Mute"} />
              </span>
            </li>
          ))}
        </ul>
        {mutedUntil && (
          <p className="text-sm text-danger">
            A moderator muted you until <LocalTime iso={mutedUntil} />. You can still read.
          </p>
        )}
      </section>

      {isMod && (
        <div className="space-y-3">
          <Fold
            name="community-sections"
            icon="🤖"
            title="Autopilot"
            testId="autopilot"
            open={appealsWaiting.length > 0}
            summary={[
              `${autopilotWeek.refused} kept out this week`,
              appealsWaiting.length ? `${appealsWaiting.length} ${appealsWaiting.length === 1 ? "appeal waits" : "appeals wait"} for you` : "nothing waiting",
            ].join(" · ")}
          >
            <div className="space-y-4 px-5 py-5 sm:px-6" aria-label="Autopilot">
              <p className="hint">
                Your community&apos;s agent keeps spam out, hides messages several members report when it agrees, and nudges members before they post
                something rude. It works even if nobody moderates; you get one summary a day. Undo anything in one tap.
              </p>
            <p className="text-sm" data-testid="autopilot-week">
              Last 7 days: {autopilotWeek.refused} kept out · {autopilotWeek.hidden} hidden after reports · {autopilotWeek.nudged} nudged
            </p>
            {appealsWaiting.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Appeals ({appealsWaiting.length})</h3>
                <p className="hint">Optional: if nobody answers within 3 days, members with a good history here get their message back automatically.</p>
                <ul className="divide-y divide-border">
                  {appealsWaiting.map((e) => (
                    <li key={e.id} className="space-y-1 py-2" data-testid="appeal-item">
                      <p className="rounded-lg bg-accent-soft px-2 py-1 text-sm">“{e.excerpt}”</p>
                      <p className="text-xs text-muted">
                        {who(e.user_id ?? "")} · {e.action === "refused" ? "not posted" : "hidden after reports"} ({e.verdict}) · appealed <LocalTime iso={e.appealed_at ?? e.created_at} />
                      </p>
                      <span className="flex gap-2">
                        <ActionButton action={resolveAppealAction.bind(null, e.id, id, true)} label={e.action === "refused" ? "Accept: post it" : "Accept: restore it"} variant="btn-primary" />
                        <ActionButton action={resolveAppealAction.bind(null, e.id, id, false)} label="Reject" />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {autopilotRecent.length > 0 && (
              <details>
                <summary className="cursor-pointer text-sm font-medium">What it did recently ({autopilotRecent.length})</summary>
                <ul className="mt-1 divide-y divide-border">
                  {autopilotRecent.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="autopilot-event">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">“{e.excerpt}”</span>
                        <span className="block text-xs text-muted">
                          {AUTOPILOT_ACTION[e.action] ?? e.action} ({e.verdict}) · {who(e.user_id ?? "")} · <LocalTime iso={e.created_at} />
                          {e.appeal_status === "accepted" && " · undone"}
                        </span>
                      </span>
                      {(e.action === "refused" || e.action === "hidden_after_reports") && e.appeal_status !== "accepted" && e.appeal_status !== "rejected" && (
                        <ActionButton action={resolveAppealAction.bind(null, e.id, id, true)} label="Undo" />
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {isOwner && suggested.length > 0 && (
              <div className="space-y-2" data-testid="suggested-moderators">
                <h3 className="text-sm font-semibold">Need a hand?</h3>
                <p className="hint">Active members with a clean record here, who could help as moderators.</p>
                <ul className="divide-y divide-border">
                  {suggested.map((s) => (
                    <li key={s.userId} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                      <span className="min-w-0 flex-1">{who(s.userId)} <span className="text-xs text-muted">· {s.messages} messages this month</span></span>
                      <ActionButton action={setCommunityRoleAction.bind(null, id, s.userId, "moderator")} label="Make moderator" />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            </div>
          </Fold>

          <Fold
            name="community-sections"
            icon="🛡️"
            title="Moderation"
            testId="fold-moderation"
            open={Boolean(requests?.length || reports?.length)}
            summary={[
              requests?.length ? `${requests.length} asking to join` : "Invite link",
              reports?.length ? `${reports.length} reported` : "nothing reported",
            ].join(" · ")}
          >
            <div className="space-y-4 px-5 py-5 sm:px-6" aria-label="Moderation">
            <JoinLinkBox create={communityLinkAction.bind(null, id)} revoke={revokeCommunityLinkAction.bind(null, id)} what={community.name} />

            {requests && requests.length > 0 && (
              <div>
                <h3 className="mb-1 text-sm font-semibold">Asking to join</h3>
                <ul className="divide-y divide-border">
                  {requests.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-2 py-2" data-testid="join-request">
                      <span className="flex-1 text-sm">{who(r.user_id)}</span>
                      <ActionButton action={decideRequestAction.bind(null, r.id, true)} label="Let in" variant="btn-primary" />
                      <ActionButton action={decideRequestAction.bind(null, r.id, false)} label="Decline" />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h3 className="mb-1 text-sm font-semibold">Reported messages</h3>
              {reports && reports.length > 0 ? (
                <ul className="divide-y divide-border">
                  {reports.map((r) => (
                    <li key={r.id} className="space-y-1 py-2" data-testid="report">
                      <p className="rounded-lg bg-accent-soft px-2 py-1 text-sm">“{r.excerpt}”</p>
                      <p className="text-xs text-muted">Reason: {r.reason} · <LocalTime iso={r.created_at} /></p>
                      <span className="flex gap-2">
                        {r.message_id && r.conversation_id && (
                          <ActionButton action={removeMessageAction.bind(null, r.message_id, r.conversation_id)} label="Remove message" variant="btn-danger" />
                        )}
                        <ActionButton action={dismissReportAction.bind(null, r.id, `/communities/${id}`)} label="Dismiss" />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">Nothing reported. 🎉</p>
              )}
            </div>
            </div>
          </Fold>

          <Fold
            name="community-sections"
            icon="🤝"
            title="Official partners"
            testId="fold-partners"
            summary={partners.length ? `${partners.filter((p) => p.status === "active").length} active · ${partners.filter((p) => p.status === "invited").length} invited` : "Invite a local business your members use"}
          >
            <div className="space-y-4 px-5 py-5 sm:px-6" aria-label="Official partners">
              <p className="hint">Invite a local business your members use. Once it accepts, members can mention it in the chats and it answers from its public information.</p>
            {partners.length > 0 && (
              <ul className="divide-y divide-border">
                {partners.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2 py-2" data-testid="partner">
                    <span className="min-w-0 flex-1 text-sm">
                      {p.agent.avatar} {p.agent.display_name} <span className="text-muted">@{p.agent.handle}</span>
                      {p.status === "invited" && <span className="ml-2 text-xs text-muted">invited, waiting for them to accept</span>}
                    </span>
                    <ActionButton action={removePartnerAction.bind(null, id, p.agent.id)} label={p.status === "invited" ? "Cancel invitation" : "Remove"} />
                  </li>
                ))}
              </ul>
            )}
            <BusinessHandleForm
              action={invitePartnerAction.bind(null, id)}
              search={searchBusinessesAction}
              exclude={partners.map((p) => p.agent.id)}
              button="Invite"
              done="invitation sent. It appears as a partner once they accept."
            />
            </div>
          </Fold>

          <Fold
            name="community-sections"
            icon="👥"
            title="Members"
            testId="fold-members"
            summary={[`${members} ${members === 1 ? "member" : "members"}`, ...(bans?.length ? [`${bans.length} banned`] : [])].join(" · ")}
          >
            <div className="space-y-4 px-5 py-5 sm:px-6" aria-label="Members">
            <ul className="divide-y divide-border">
              {(people ?? []).map((p) => {
                const isMe = p.user_id === user.id;
                const muted = stillMuted(p.muted_until);
                const canAct = !isMe && p.role !== "owner" && (isOwner || p.role === "member");
                return (
                  <li key={p.user_id} className="flex flex-wrap items-center gap-2 py-2" data-testid="community-member">
                    <span className="min-w-0 flex-1 text-sm">
                      {isMe ? "You" : who(p.user_id)}
                      {ROLE_LABEL[p.role as keyof typeof ROLE_LABEL] && (
                        <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent">{ROLE_LABEL[p.role as keyof typeof ROLE_LABEL]}</span>
                      )}
                      {muted && <span className="ml-2 text-xs text-danger">muted</span>}
                    </span>
                    {canAct && (
                      <span className="flex flex-wrap gap-1">
                        {isOwner && p.role === "member" && <ActionButton action={setCommunityRoleAction.bind(null, id, p.user_id, "moderator")} label="Make moderator" />}
                        {isOwner && p.role === "moderator" && <ActionButton action={setCommunityRoleAction.bind(null, id, p.user_id, "member")} label="Remove as moderator" />}
                        {p.role === "member" && (
                          <ActionButton action={muteMemberAction.bind(null, id, p.user_id, muted ? 0 : 24)} label={muted ? "Unmute" : "Mute 24h"} />
                        )}
                        <ActionButton action={removeFromCommunityAction.bind(null, id, p.user_id, false, "")} label="Remove" />
                        <ActionButton action={removeFromCommunityAction.bind(null, id, p.user_id, true, "")} label="Ban" variant="btn-danger" />
                        {isOwner && <ConfirmButton action={setCommunityRoleAction.bind(null, id, p.user_id, "owner")} label="Make owner" question="Hand over ownership? You'll become a moderator." variant="btn-ghost" />}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {bans && bans.length > 0 && (
              <details>
                <summary className="cursor-pointer text-sm font-medium">Banned ({bans.length})</summary>
                <ul className="mt-1 divide-y divide-border">
                  {bans.map((b) => (
                    <li key={b.user_id} className="flex items-center gap-2 py-2 text-sm">
                      <span className="flex-1">{who(b.user_id)}</span>
                      <ActionButton action={unbanAction.bind(null, id, b.user_id)} label="Unban" />
                    </li>
                  ))}
                </ul>
              </details>
            )}
            </div>
          </Fold>

          <Fold name="community-sections" icon="✏️" title="Edit community" testId="fold-edit" summary="Name, description, rules, picture and who can join">
            <div className="px-5 py-5 sm:px-6">
              <EditCommunityForm
                id={id}
                isOwner={isOwner}
                avatars={COMMUNITY_AVATARS}
                values={{ name: community.name, description: community.description ?? "", avatar: community.avatar, visibility: community.visibility as "public" | "private", houseRules: community.house_rules ?? [], language: community.language }}
              />
            </div>
          </Fold>
        </div>
      )}

      <section className="card flex flex-wrap gap-2" aria-label="Leave">
        {isOwner ? (
          <ConfirmButton action={deleteCommunityAction.bind(null, id)} label="Delete community" question="Delete this community, its chats and all messages for everyone? This can't be undone." />
        ) : (
          <ConfirmButton action={leaveCommunityAction.bind(null, id)} label="Leave community" question="Leave this community and its chats?" variant="btn-ghost" />
        )}
      </section>
    </div>
  );
}
