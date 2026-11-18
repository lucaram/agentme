import { Avatar } from "@/components/Avatar";
import { avatarText } from "@/lib/profile/avatar";
import Link from "next/link";
import { PresenceBadge } from "@/components/presence/PresenceBadge";
import { notFound } from "next/navigation";
import { historyPage, prepareHistory } from "@/lib/chat/history";
import { EMPTY_HISTORY } from "@/lib/chat/history-types";
import { ChatTimeline } from "@/components/chat/ChatTimeline";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Composer } from "./Composer";
import { leaveConversation } from "../../actions";
import { InviteLink } from "./InviteLink";
import { OpenRequests } from "@/components/requests/OpenRequests";
import { ModerationAttention } from "@/components/moderation/ModerationAttention";
import { MyAgentHome } from "./MyAgentHome";
import { touchSeen } from "@/lib/social/digest";
import { dmState } from "@/lib/people/dm";
import { businessIdeas, chatIdeas, personalIdeas, type Idea } from "@/lib/agents/ideas";
import { ThreadTitle } from "./ThreadTitle";
import { canPost, communityMembership, groupRole, isGroupAdmin, isModerator, type ConvRow } from "@/lib/social/shared";

export default async function ChatPage({ params, searchParams }: PageProps<"/chats/[id]">) {
  const { id } = await params;
  const { t } = await searchParams;
  const { user, agent } = await requireAgent();
  const supabase = await createClient();

  // All reads use the user's session: RLS decides what is visible.
  const { data: conv } = await supabase.from("conversations").select("*, conversation_members(user_id)").eq("id", id).maybeSingle();
  if (!conv) notFound();

  // My Agent: the list of requests (no ?t), one request's thread (?t=<id>), or a new request (?t=new).
  const isMyAgent = conv.kind === "my_agent";
  const threadParam = isMyAgent && typeof t === "string" ? t : null;
  const { data: thread } =
    threadParam && threadParam !== "new" && /^[0-9a-f-]{36}$/i.test(threadParam)
      ? await supabase.from("agent_threads").select("id, title, kind").eq("id", threadParam).eq("conversation_id", id).maybeSingle()
      : { data: null };
  const showMessages = !isMyAgent || Boolean(thread);
  const [{ data: agents }, initialPage] = await Promise.all([
    supabase.from("agents").select("id, owner_id, handle, display_name, avatar, type, verified_domain"),
    showMessages ? historyPage(supabase, id, thread?.id ?? null, { mode: "initial" }) : Promise.resolve(EMPTY_HISTORY),
  ]);
  const byId = new Map((agents ?? []).map((a) => [a.id, a]));
  const byOwner = new Map((agents ?? []).map((a) => [a.owner_id, a]));
  // Businesses placed in this group or community, to mention (RLS: members see them).
  const placed =
    conv.kind === "group" || (conv.kind === "channel" && conv.community_id)
      ? (
          await supabase
            .from("business_placements")
            .select("business_agent_id")
            .eq(conv.kind === "group" ? "conversation_id" : "community_id", conv.kind === "group" ? id : conv.community_id!)
            .eq("status", "active")
        ).data ?? []
      : [];
  const mentionable = placed.map((p) => byId.get(p.business_agent_id)?.handle).filter(Boolean);

  const target = conv.target_agent ? byId.get(conv.target_agent) : undefined;

  // The organiser of a plan shared in this group can invite more people by link (RLS: own tasks only).
  const { data: ownPlan } =
    conv.kind === "group"
      ? await supabase
          .from("tasks")
          .select("id")
          .eq("group_conversation_id", id)
          .eq("owner_id", user.id)
          .not("status", "in", "(cancelled,failed,rejected,awaiting_approval)")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null };

  // 💡 Ideas for My Agent: what the agent can do, filled with real names (see lib/agents/ideas.ts).
  let examples: Idea[] | undefined;
  if (conv.kind === "my_agent") {
    if (agent.type === "business") {
      examples = user.businessRole === "staff" ? [{ label: "Opening hours", text: "What are our opening hours?" }, { label: "Customer answers", text: "What can we tell customers about our business?" }] : businessIdeas();
    } else {
      const [{ data: contacts }, { data: agentChats }, { data: myTasks }, { count: introductions }] = await Promise.all([
        supabase.from("contacts").select("requester_agent, addressee_agent").eq("status", "accepted"),
        supabase.from("conversations").select("target_agent").eq("kind", "agent_chat"),
        supabase.from("tasks").select("parsed").order("created_at", { ascending: false }).limit(100),
        supabase.from("introductions").select("*", { count: "exact", head: true }).eq("introducer_agent", agent.id),
      ]);
      const known = [
        ...(contacts ?? []).map((c) => byId.get(c.requester_agent === agent.id ? c.addressee_agent : c.requester_agent)),
        ...(agentChats ?? []).map((c) => (c.target_agent ? byId.get(c.target_agent) : undefined)),
      ].filter((a) => a !== undefined);
      const used = new Set<string>((myTasks ?? []).flatMap((t) => {
        const p = (t.parsed ?? {}) as { kind?: string; venue?: unknown };
        return [p.kind ?? "", p.venue ? "venue" : ""];
      }));
      if (introductions) used.add("introduce");
      examples = personalIdeas({
        friends: known.filter((a) => a.type === "personal").map((a) => a.handle),
        business: known.find((a) => a.type === "business")?.handle ?? null,
        used,
      });
    }
    // The list of requests (or an unknown thread): My Agent's home.
    if (!threadParam || (threadParam !== "new" && !thread)) return <MyAgentHome conversationId={id} examples={examples} now={Date.parse(new Date().toISOString())} />;
  }
  const others = conv.conversation_members.filter((m) => m.user_id !== user.id).map((m) => byOwner.get(m.user_id));
  // A direct message stays readable but closed when the other person left, or you're no longer contacts (removed or blocked).
  const dm = conv.kind === "dm" ? await dmState(id, user.id, agent.id) : null;
  const dmClosed = dm !== null && dm.state !== "open";
  const shared = conv.kind === "group" || conv.kind === "channel";
  const community = conv.kind === "channel" && conv.community_id ? (await supabase.from("communities").select("id, name, avatar").eq("id", conv.community_id).maybeSingle()).data : null;
  // Being here counts as being around (moderators who are never around get help: lib/social/digest.ts).
  if (community) await touchSeen(community.id, user.id);
  // Who may post here, and who may remove other people's messages.
  const posting = shared ? await canPost(conv as unknown as ConvRow, user.id) : { ok: true as const };

  const canModerate =
    conv.kind === "group" ? isGroupAdmin(await groupRole(id, user.id)) : community ? isModerator((await communityMembership(community.id, user.id))?.role) : false;
  const title =
    conv.kind === "my_agent"
      ? thread?.title ?? "New request"
      : conv.kind === "agent_chat"
        ? `${target?.display_name ?? "Agent"} (@${target?.handle})`
        : conv.kind === "channel"
          ? `${avatarText(community?.avatar ?? "")} ${community?.name ?? "Community"} · ${conv.title}`
          : conv.title ?? others.map((o) => o?.display_name).join(", ");
  const subtitle =
    conv.kind === "my_agent"
      ? thread?.kind === "updates"
        ? "Notes from your agent and things others asked you."
        : "Ask your agent to organise something with your contacts. It always asks before contacting anyone."
      : conv.kind === "agent_chat"
        ? `You're talking to an AI agent over A2A. It answers only from information its owner published.${target?.verified_domain ? ` ✓ Verified owner of ${target.verified_domain}.` : ""}`
        : conv.kind === "channel"
          ? conv.channel === "announcements"
            ? "Announcements from the community's moderators"
            : "Community chat · be kind, follow the rules"
          : conv.kind === "group"
            ? others.length > 6
              ? `${others.length + 1} members`
              : `Members: ${["you", ...others.map((o) => (o ? `@${o.handle}` : "someone"))].join(", ")}`
            : dm?.state === "left"
              ? "They left this chat"
              : dm?.state === "removed"
                ? "Not contacts any more"
                : "Direct message";

  const initial = await prepareHistory(supabase, user.id, agent, conv, thread?.id ?? null, initialPage);

  return (
    <div className="flex flex-1 flex-col">
      {isMyAgent && (
        <div className="mb-1 flex items-center justify-between gap-3 text-sm">
          <Link href={`/chats/${id}`} className="text-accent hover:underline" data-testid="back-to-my-agent">‹ My Agent</Link>
          {/* Inside a request the box continues it; this starts another one. */}
          {thread && <Link href={`/chats/${id}?t=new`} className="text-accent hover:underline" data-testid="new-request">＋ New request</Link>}
        </div>
      )}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          {thread && thread.kind === "request" ? <ThreadTitle threadId={thread.id} title={title} /> : <h1 className="text-lg font-semibold">{conv.kind === "agent_chat" && <Avatar value={target?.avatar} className="mr-2" />}{title}</h1>}
          <p className="text-xs text-muted">{subtitle}</p>
          {conv.kind === "dm" && others[0] && <PresenceBadge agentId={others[0].id} business={others[0].type === "business"} />}
          {conv.kind === "agent_chat" && target?.type === "business" && <PresenceBadge agentId={target.id} business />}
        </div>
        {conv.kind === "group" ? (
          <Link href={`/groups/${id}`} className="text-xs text-accent hover:underline">Group info ›</Link>
        ) : conv.kind === "channel" && community ? (
          <Link href={`/communities/${community.id}`} className="text-xs text-accent hover:underline">Community ›</Link>
        ) : (
          conv.kind !== "my_agent" && (
            <form action={leaveConversation.bind(null, id)}>
              <button className="text-xs text-muted hover:text-danger">{conv.kind === "agent_chat" ? "Delete chat" : "Leave"}</button>
            </form>
          )
        )}
      </div>
      {ownPlan && (
        <div className="mb-3 flex justify-end">
          <InviteLink taskId={ownPlan.id} title={title} />
        </div>
      )}

      <ChatTimeline key={`${user.id}:${id}:${thread?.id ?? "new"}`} initial={initial} leading={thread?.kind === "updates" ? <div className="mb-4"><OpenRequests title="Needs your answer" kinds={["info_request", "question", "group_invite"]} hint="Only you can decide these. Nothing is shared until you choose." /><ModerationAttention /></div> : undefined}>
      {!posting.ok && (
        <p className="mt-4 rounded-2xl border border-border bg-surface px-4 py-2 text-center text-sm text-muted" data-testid="cannot-post">
          {posting.error} {!initial.suspended && "You can still ask @agent privately."}
        </p>
      )}
      {initial.suspended ? null : dmClosed ? (
        <p className="mt-4 rounded-2xl border border-border bg-surface px-4 py-3 text-center text-sm text-muted" data-testid="dm-closed">
          {dm?.state === "removed" ? (
            <>
              You&apos;re no longer contacts.{" "}
              {dm.otherHandle && <Link href={`/u/${dm.otherHandle}`} className="text-accent underline">Send a contact request</Link>} to message again.
            </>
          ) : dm?.state === "blocked" ? (
            "You can't message this person."
          ) : (
            <>
              You can&apos;t send messages here any more. To talk again, open them from{" "}
              <Link href="/contacts" className="text-accent underline">Contacts</Link> and start a new chat.
            </>
          )}
        </p>
      ) : (
      <Composer
        key={`${id}:${threadParam ?? ""}`}
        conversationId={id}
        nearMe={isMyAgent}
        attachments={conv.kind === "my_agent" ? "agent" : conv.kind === "agent_chat" ? "none" : "all"}
        threadId={isMyAgent ? (thread && thread.kind === "request" ? thread.id : "new") : undefined}
        placeholder={
          conv.kind === "my_agent"
            ? "e.g. Arrange dinner with @marco and @paul on Saturday evening"
            : conv.kind === "agent_chat"
              ? `Ask @${target?.handle ?? "agent"} a question`
              : !posting.ok
                ? "@agent … (only you see it)"
                : mentionable.length
                  ? `Message — @${mentionable[0]} to ask the business, or @agent to ask yours`
                  : "Message — or @agent to ask your agent (only you see it)"
        }
        thinkingLabel={conv.kind === "dm" || conv.kind === "group" || conv.kind === "channel" ? undefined : "Agent is thinking…"}
        examples={
          isMyAgent
            ? thread
              ? undefined
              : examples
            : conv.kind === "group" || conv.kind === "channel"
              ? chatIdeas({ kind: conv.kind, business: mentionable[0] ?? null, moderator: canModerate })
              : undefined
        }
        collapseExamples={!isMyAgent}
        examplesHint={isMyAgent ? undefined : "Only you see @agent and its answer."}
      />
      )}
      </ChatTimeline>
    </div>
  );
}
