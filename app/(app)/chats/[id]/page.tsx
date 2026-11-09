import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { Composer } from "./Composer";
import { TaskCard, type TaskView } from "./TaskCard";
import { ProposalCard, type ProposalView } from "./ProposalCard";
import { PollCard } from "./PollCard";
import { AssignCard } from "./AssignCard";
import { leaveConversation } from "../../actions";
import { MarkRead } from "@/components/MarkRead";
import { DraftReply } from "./DraftReply";
import { RichText } from "@/components/RichText";
import { LocalTime } from "@/components/LocalTime";
import { InviteLink } from "./InviteLink";
import { MessageActions } from "./MessageActions";
import { OpenRequests } from "@/components/requests/OpenRequests";
import { MyAgentHome } from "./MyAgentHome";
import { businessIdeas, chatIdeas, personalIdeas, type Idea } from "@/lib/agents/ideas";
import { ThreadTitle } from "./ThreadTitle";
import type { Database } from "@/lib/database.types";
import { AgentName } from "@/components/AgentName";
import { adminClient } from "@/lib/supabase/admin";
import { waysOf } from "@/lib/business/booking";
import { canPost, communityMembership, groupRole, isGroupAdmin, isModerator, type ConvRow } from "@/lib/social/shared";

export default async function ChatPage({ params, searchParams }: PageProps<"/chats/[id]">) {
  const { id } = await params;
  const { t } = await searchParams;
  const { user, agent } = await requireAgent();
  const supabase = await createClient();

  // All reads use the user's session: RLS decides what is visible.
  const { data: conv } = await supabase.from("conversations").select("*, conversation_members(user_id)").eq("id", id).maybeSingle();
  if (!conv) notFound();
  // Seen now (database clock). The client also re-marks when new messages arrive while open.
  await supabase.rpc("mark_conversation_read", { p_conversation: id });

  // My Agent: the list of requests (no ?t), one request's thread (?t=<id>), or a new request (?t=new).
  const isMyAgent = conv.kind === "my_agent";
  const threadParam = isMyAgent && typeof t === "string" ? t : null;
  const { data: thread } =
    threadParam && threadParam !== "new" && /^[0-9a-f-]{36}$/i.test(threadParam)
      ? await supabase.from("agent_threads").select("id, title, kind").eq("id", threadParam).maybeSingle()
      : { data: null };
  const showMessages = !isMyAgent || Boolean(thread);
  const [{ data: messages }, { data: agents }] = await Promise.all([
    showMessages
      ? (thread ? supabase.from("messages").select("*").eq("conversation_id", id).eq("thread_id", thread.id) : supabase.from("messages").select("*").eq("conversation_id", id))
          .order("created_at")
          .limit(200)
      : Promise.resolve({ data: [] as Database["public"]["Tables"]["messages"]["Row"][] }),
    supabase.from("agents").select("id, owner_id, handle, display_name, avatar, type"),
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

  const metas = (messages ?? []).map((m) => m.metadata as { task_id?: string; proposal_id?: string; step_id?: string });
  const taskIds = [...new Set(metas.map((m) => m.task_id).filter(Boolean) as string[])];
  const proposalIds = [...new Set(metas.map((m) => m.proposal_id).filter(Boolean) as string[])];

  const [{ data: tasks }, { data: exchanges }, { data: proposals }, { data: myFacts }] = await Promise.all([
    // RLS: tasks are owner-only; exchanges the user sent or received.
    taskIds.length ? supabase.from("tasks").select("*").in("id", taskIds) : Promise.resolve({ data: [] }),
    taskIds.length ? supabase.from("task_exchanges").select("*").in("task_id", taskIds).order("created_at") : Promise.resolve({ data: [] }),
    proposalIds.length ? supabase.from("proposals").select("*").in("id", proposalIds) : Promise.resolve({ data: [] }),
    supabase.from("agent_facts").select("category, value"),
  ]);
  // A plan's place: that business's own ways to book or order (public; read on the server).
  const venueIds = [...new Set((proposals ?? []).map((p) => (p.content as { venue?: { agent_id?: string } | null }).venue?.agent_id).filter((v): v is string => Boolean(v)))];
  const { data: venueRows } = venueIds.length ? await adminClient().from("agents").select("id, business_info").in("id", venueIds).eq("type", "business") : { data: [] };
  const venueWays = new Map((venueRows ?? []).map((v) => [v.id, waysOf(v.business_info)]));
  // Steps & answers: visible to the plan owner and members of the plan's group (RLS can_see_task).
  const planTaskIds = [...new Set([...taskIds, ...(proposals ?? []).map((p) => p.task_id)])];
  const { data: steps } = planTaskIds.length
    ? await supabase.from("plan_steps").select("*").in("task_id", planTaskIds)
    : { data: [] };
  const answerStepIds = (steps ?? []).filter((s) => s.type === "rsvp" || s.type === "poll").map((s) => s.id);
  const assignStepIds = (steps ?? []).filter((s) => s.type === "assign").map((s) => s.id);
  const [{ data: stepResponses }, { data: claims }] = await Promise.all([
    answerStepIds.length ? supabase.from("step_responses").select("*").in("step_id", answerStepIds) : Promise.resolve({ data: [] }),
    assignStepIds.length ? supabase.from("item_claims").select("*").in("step_id", assignStepIds) : Promise.resolve({ data: [] }),
  ]);

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
      examples = businessIdeas();
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
  // The other person left this direct message: keep it readable, but closed.
  const dmClosed = conv.kind === "dm" && others.length === 0;
  const shared = conv.kind === "group" || conv.kind === "channel";
  const community = conv.kind === "channel" && conv.community_id ? (await supabase.from("communities").select("id, name, avatar").eq("id", conv.community_id).maybeSingle()).data : null;
  // Who may post here, and who may remove other people's messages.
  const posting = shared ? await canPost(conv as unknown as ConvRow, user.id) : { ok: true as const };
  const canModerate =
    conv.kind === "group" ? isGroupAdmin(await groupRole(id, user.id)) : community ? isModerator((await communityMembership(community.id, user.id))?.role) : false;
  const title =
    conv.kind === "my_agent"
      ? thread?.title ?? "New request"
      : conv.kind === "agent_chat"
        ? `${target?.avatar ?? ""} ${target?.display_name ?? "Agent"} (@${target?.handle})`
        : conv.kind === "channel"
          ? `${community?.avatar ?? ""} ${community?.name ?? "Community"} · ${conv.title}`
          : conv.title ?? others.map((o) => o?.display_name).join(", ");
  const subtitle =
    conv.kind === "my_agent"
      ? thread?.kind === "updates"
        ? "Notes from your agent and things others asked you."
        : "Ask your agent to organise something with your contacts. It always asks before contacting anyone."
      : conv.kind === "agent_chat"
        ? "You're talking to an AI agent over A2A. It answers only from information its owner published."
        : conv.kind === "channel"
          ? conv.channel === "announcements"
            ? "Announcements from the community's moderators"
            : "Community chat · be kind, follow the rules"
          : conv.kind === "group"
            ? others.length > 6
              ? `${others.length + 1} members`
              : `Members: ${["you", ...others.map((o) => (o ? `@${o.handle}` : "someone"))].join(", ")}`
            : dmClosed
              ? "They left this chat"
              : "Direct message";

  return (
    <div className="flex flex-1 flex-col">
      {/* Seeing the chat (including messages that arrive while it is open) clears its unread counter. */}
      <MarkRead conversationId={id} latestMessageId={(messages ?? []).at(-1)?.id ?? null} threadId={thread?.id} />
      <RealtimeRefresh
        channel={`conv-${id}`}
        tables={["messages", "tasks", "task_exchanges", "proposals", "plan_steps", "step_responses", "item_claims", "inbox_items"]}
        filter={`conversation_id=eq.${id}`}
      />
      {isMyAgent && (
        <div className="mb-1 flex items-center justify-between gap-3 text-sm">
          <Link href={`/chats/${id}`} className="text-accent hover:underline" data-testid="back-to-my-agent">‹ My Agent</Link>
          {/* Inside a request the box continues it; this starts another one. */}
          {thread && <Link href={`/chats/${id}?t=new`} className="text-accent hover:underline" data-testid="new-request">＋ New request</Link>}
        </div>
      )}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          {thread && thread.kind === "request" ? <ThreadTitle threadId={thread.id} title={title} /> : <h1 className="text-lg font-semibold">{title}</h1>}
          <p className="text-xs text-muted">{subtitle}</p>
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

      {thread?.kind === "updates" && (
        <div className="mb-4">
          <OpenRequests title="Needs your answer" kinds={["info_request", "question"]} hint="Only you can decide these. Nothing is shared until you choose." />
        </div>
      )}

      <ol className="flex flex-1 flex-col gap-3" aria-label="Messages">
        {(messages ?? []).map((m) => {
          const meta = m.metadata as { kind?: string; task_id?: string; proposal_id?: string; step_id?: string; draft?: string; sent?: boolean };
          const isPrivate = Boolean(m.visible_to);
          const mine = m.sender_user_id === user.id;
          const senderAgent = m.sender_agent_id ? byId.get(m.sender_agent_id) : undefined;
          const senderUser = m.sender_user_id ? byOwner.get(m.sender_user_id) : undefined;
          const system = !m.sender_agent_id && !m.sender_user_id;

          if (system) {
            return (
              <li key={m.id} className={`text-center text-xs ${meta.kind === "error" ? "text-danger" : "text-muted"}`} data-testid="system-note">
                <span className="tabular-nums opacity-70">
                  <LocalTime iso={m.created_at} />
                </span>{" "}
                - {m.content}
              </li>
            );
          }
          const task = meta.kind === "task_card" ? tasks?.find((t) => t.id === meta.task_id) : undefined;
          const proposal = meta.kind === "proposal" ? proposals?.find((p) => p.id === meta.proposal_id) : undefined;
          const rsvpStep = proposal ? steps?.find((s) => s.task_id === proposal.task_id && s.type === "rsvp") : undefined;
          const pollStep = meta.kind === "poll" ? steps?.find((s) => s.id === meta.step_id) : undefined;
          const assignStep = meta.kind === "assign" ? steps?.find((s) => s.id === meta.step_id) : undefined;
          const isPlanOwner = (taskId?: string) => Boolean(taskId && (tasks ?? []).some((t) => t.id === taskId && t.owner_id === user.id));

          return (
            <li key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
              <span className="mb-0.5 flex items-center gap-1 text-xs text-muted">
                {m.is_ai_generated ? (
                  <>
                    <AgentName agent={senderAgent}>{senderAgent?.avatar} {senderAgent ? `@${senderAgent.handle}'s agent` : "An agent"}</AgentName>
                    <span className="rounded bg-agent-border px-1 text-[10px] font-semibold uppercase text-foreground" title="Written by an AI agent">AI</span>
                  </>
                ) : mine ? (
                  "You"
                ) : (
                  `${senderUser?.avatar ?? ""} ${senderUser?.display_name ?? "Someone"}`
                )}
                {isPrivate && (
                  <span className="text-[10px]" data-testid="private-label" title="Only you can see this message">
                    · 🔒 only visible to you
                  </span>
                )}
              </span>
              <div className={`flex max-w-[85%] items-start gap-1 ${mine ? "flex-row-reverse" : ""}`}>
                <div
                  className={`whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${isPrivate ? "border border-dashed opacity-90" : ""} ${
                    m.removed_at
                      ? "border border-border italic text-muted"
                      : m.is_ai_generated
                        ? "border border-agent-border bg-agent"
                        : mine
                          ? "bg-accent text-white dark:text-black"
                          : "border border-border bg-surface"
                  }`}
                  data-testid={isPrivate ? "private-message" : m.removed_at ? "removed-message" : undefined}
                >
                  {m.is_ai_generated && !m.removed_at ? <RichText text={m.content} /> : m.content}
                </div>
                {shared && !isPrivate && !m.removed_at && (
                  <MessageActions messageId={m.id} conversationId={id} canReport={!mine} canRemove={mine || canModerate} />
                )}
              </div>
              {meta.kind === "draft" && meta.draft && <DraftReply conversationId={id} messageId={m.id} draft={meta.draft} sent={Boolean(meta.sent)} />}
              {task && (
                <TaskCard
                  task={task as TaskView}
                  exchanges={(exchanges ?? []).filter((e) => e.task_id === task.id)}
                  steps={(steps ?? []).filter((s) => s.task_id === task.id)}
                  agents={byId}
                  canAct={task.owner_id === user.id}
                />
              )}
              {proposal && (
                <ProposalCard
                  proposal={proposal as ProposalView}
                  rsvpStepId={rsvpStep?.id ?? null}
                  rsvpConfig={(rsvpStep?.config ?? {}) as { min?: number | null; max?: number | null }}
                  canChange={proposal.status === "accepted" && isPlanOwner(proposal.task_id)}
                  responses={(stepResponses ?? []).filter((r) => r.step_id === rsvpStep?.id)}
                  agents={byId}
                  myAgentId={agent.id}
                  myHandle={agent.handle}
                  inGroup={conv.kind === "group"}
                  venueWays={venueWays.get((proposal as ProposalView).content.venue?.agent_id ?? "") ?? []}
                />
              )}
              {assignStep && (
                <AssignCard
                  step={assignStep}
                  claims={(claims ?? []).filter((c) => c.step_id === assignStep.id)}
                  agents={byId}
                  myAgentId={agent.id}
                  myHandle={agent.handle}
                />
              )}
              {pollStep && (
                <PollCard
                  step={pollStep}
                  votes={(stepResponses ?? []).filter((r) => r.step_id === pollStep.id)}
                  agents={byId}
                  myAgentId={agent.id}
                  myHandle={agent.handle}
                  myFacts={myFacts ?? []}
                  isOrganiser={pollStep.task_id ? (tasks ?? []).some((t) => t.id === pollStep.task_id && t.owner_id === user.id) : false}
                />
              )}
            </li>
          );
        })}
      </ol>

      {!posting.ok && (
        <p className="mt-4 rounded-2xl border border-border bg-surface px-4 py-2 text-center text-sm text-muted" data-testid="cannot-post">
          {posting.error} You can still ask @agent privately.
        </p>
      )}
      {dmClosed ? (
        <p className="mt-4 rounded-2xl border border-border bg-surface px-4 py-3 text-center text-sm text-muted" data-testid="dm-closed">
          You can&apos;t send messages here any more. To talk again, open them from{" "}
          <Link href="/contacts" className="text-accent underline">Contacts</Link> and start a new chat.
        </p>
      ) : (
      <Composer
        conversationId={id}
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
    </div>
  );
}
