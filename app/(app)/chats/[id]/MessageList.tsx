"use client";
import { Avatar } from "@/components/Avatar";

import Link from "next/link";
import type { HistoryBundle } from "@/lib/chat/history-types";
import { MentionText } from "@/components/chat/MentionText";
import { RichText } from "@/components/RichText";
import { LocalTime } from "@/components/LocalTime";
import { AgentName } from "@/components/AgentName";
import { BusinessWays } from "@/components/BusinessWays";
import { ActionButton } from "@/components/ActionButton";
import { MessageMedia } from "@/components/chat/MessageMedia";
import { MessageReceipt } from "@/components/chat/MessageReceipt";
import { MessageReactions, ReactionButton, ReactionChips } from "@/components/chat/MessageReactions";
import { LocationSchema, type AttachmentView } from "@/lib/chat/rich";
import { canForward as canForwardMessage, forwardLabel, type Forwarded } from "@/lib/social/forward";
import { canQuote, quoteSnippet, quoteAttribution } from "@/lib/social/quote";
import { openAgentChat } from "../../actions";
import { TaskCard, type TaskView } from "./TaskCard";
import { ProposalCard, type ProposalView } from "./ProposalCard";
import { PollCard } from "./PollCard";
import { AssignCard } from "./AssignCard";
import { DraftReply } from "./DraftReply";
import { MessageActions } from "./MessageActions";
import { FactSuggestion } from "./FactSuggestion";
import { BusinessSuggestion } from "./BusinessSuggestion";
import { AskTeam } from "./AskTeam";
import { ForwardButton } from "./Forward";
import { ForwardIcon, QuoteBlock, ReplyButton } from "./Reply";
import { HiddenAppeal } from "./HiddenAppeal";

const FLAG_LABEL: Record<string, string> = {
  selling: "🏷️ possible selling",
  spam: "🏷️ possibly spam (posted anyway)",
  disrespectful: "⚠️ posted after a respect nudge",
  abusive: "⚠️ posted after a respect nudge",
  off_topic: "↪️ possibly off-topic",
};

export function MessageList({ bundle, unreadId }: { bundle: HistoryBundle; unreadId: string | null }) {
  const { messages, attachments, tasks, exchanges, proposals, steps, responses: stepResponses, claims, facts: myFacts, canReplyHere, canModerate } = bundle;
  const agent = bundle.agent; const user = { id: bundle.userId }; const id = bundle.conversationId;
  const conv = { kind: bundle.kind }; const isMyAgent = conv.kind === "my_agent"; const shared = conv.kind === "group" || conv.kind === "channel";
  const byId = new Map(bundle.agents.map((a) => [a.id, a])); const byOwner = new Map(bundle.agents.map((a) => [a.owner_id, a]));
  const receipts = new Map(bundle.receipts.map((r) => [r.message_id, r])); const outgoingReceiptIds = new Set(receipts.keys());
  const reactions = new Map(bundle.reactions.map((r) => [r.message_id, r]));
  const currentActions = new Map(bundle.actions); const legacyIdentities = new Map(bundle.legacy);
  const quotedById = new Map([...messages, ...bundle.quotes].map((q) => [q.id, q]));
  const authorOf = (q: { sender_user_id: string | null; sender_agent_id: string | null; metadata?: unknown }) => quoteAttribution(q,
    q.sender_agent_id ? `@${byId.get(q.sender_agent_id)?.handle ?? "an"}'s agent` : q.sender_user_id === user.id ? "You" : byOwner.get(q.sender_user_id ?? "")?.display_name ?? "Someone").author;
  return <>
        {(messages ?? []).map((m) => {
          const meta = m.metadata as { kind?: string; task_id?: string; proposal_id?: string; step_id?: string; draft?: string; sent?: boolean; decided?: string; flags?: string[]; auto_hidden?: boolean; appeal?: string; business_id?: string; handle?: string; handoff_offer?: boolean; handoff_sent?: boolean; asked_by?: string; booking_ways?: unknown; booking_business_id?: string; forwarded?: Forwarded; sources?: { url?: string; title?: string }[] };
          // Where a looked-up answer came from: links to the pages themselves (web addresses only).
          const sources = (Array.isArray(meta.sources) ? meta.sources : []).filter((s) => typeof s?.url === "string" && /^https?:\/\//i.test(s.url)).slice(0, 3);
          const isPrivate = Boolean(m.visible_to);
          const mine = m.sender_user_id === user.id;
          const senderAgent = m.sender_agent_id ? byId.get(m.sender_agent_id) : undefined;
          const senderUser = m.sender_user_id ? byOwner.get(m.sender_user_id) : undefined;
          const system = !m.sender_agent_id && !m.sender_user_id && !m.deleted_at;
          // Plan cards, drafts, suggestions and app notes can't be forwarded; messages can.
          const forwardOk = canForwardMessage({ ...m, system }).ok;
          // ↩ Reply: this message can be quoted here; and the message this one quotes (if any).
          const replyTarget = canReplyHere && canQuote(m) ? { id: m.id, author: authorOf(m), snippet: quoteSnippet(m.content) } : undefined;
          const quoted = m.reply_to ? quotedById.get(m.reply_to) : undefined;
          const quoteState = !quoted || (quoted.visible_to && quoted.visible_to !== user.id) ? "missing" : quoted.deleted_at ? "deleted" : quoted.removed_at ? "removed" : "ok";
          // Actions on this message: in direct chats, groups and communities; and, to reply or forward (labelled
          // "from @you's agent"), your own agent's replies in My Agent and your private @agent answers.
          const canDelete = mine && !m.sender_agent_id && !m.is_ai_generated && !m.removed_at && (!bundle.deletableMessageIds || bundle.deletableMessageIds.includes(m.id));
          const reactOk = !bundle.suspended && !isPrivate && !m.removed_at && (conv.kind !== "dm" || canReplyHere);
          const showActions = !m.removed_at && (reactOk || canDelete || (!isPrivate && Boolean(shared || conv.kind === "dm" || replyTarget || forwardOk)));

          if (system) {
            return (
              <li key={m.id} id={`m-${m.id}`} data-timeline-message={m.id} className={`flex flex-wrap items-baseline justify-center gap-x-2 gap-y-0.5 py-1 text-center text-xs ${meta.kind === "error" ? "text-danger" : "text-muted"}`} data-testid="system-note">
                <span>{m.content}</span>
                <span className="text-[11px] tabular-nums opacity-70" data-testid="message-timestamp">
                  <LocalTime iso={m.created_at} />
                </span>
              </li>
            );
          }
          const task = !m.removed_at && meta.kind === "task_card" ? tasks?.find((t) => t.id === meta.task_id) : undefined;
          const proposal = !m.removed_at && meta.kind === "proposal" ? proposals?.find((p) => p.id === meta.proposal_id) : undefined;
          const rsvpStep = proposal ? steps?.find((s) => s.task_id === proposal.task_id && s.type === "rsvp") : undefined;
          const pollStep = !m.removed_at && meta.kind === "poll" ? steps?.find((s) => s.id === meta.step_id) : undefined;
          const assignStep = !m.removed_at && meta.kind === "assign" ? steps?.find((s) => s.id === meta.step_id) : undefined;
          const isPlanOwner = (taskId?: string) => bundle.canManageBusiness !== false && Boolean(taskId && (tasks ?? []).some((t) => t.id === taskId && t.owner_id === user.id));
          const messageFiles = !m.removed_at ? (attachments ?? []).filter((a) => a.message_id === m.id) as AttachmentView[] : [];
          const sharedLocation = !m.removed_at ? LocationSchema.safeParse((m.metadata as { shared_location?: unknown }).shared_location).data : undefined;
          const hasMedia = messageFiles.length > 0 || Boolean(sharedLocation);

          return (
            <MessageReactions key={m.id} messageId={m.id} conversationId={id} userId={user.id} summary={reactions.get(m.id)} available={!isPrivate && !m.removed_at}><li id={`m-${m.id}`} data-timeline-message={m.id} className={`group flex flex-col ${mine ? "items-end" : "items-start"}`}>
              {m.id === unreadId && <div className="mb-3 flex w-full items-center justify-center gap-3 text-xs font-medium text-accent" role="separator" aria-label="New messages" data-testid="new-messages-divider"><span className="h-px flex-1 bg-border" />New messages<span className="h-px flex-1 bg-border" /></div>}
              <span className="mb-0.5 flex flex-wrap items-center gap-1 text-xs text-muted">
                {m.is_ai_generated ? (
                  <>
                    <AgentName agent={senderAgent}><Avatar value={senderAgent?.avatar} /> {senderAgent ? `@${senderAgent.handle}'s agent` : "An agent"}</AgentName>
                    <span className="rounded bg-agent-border px-1 text-[10px] font-semibold uppercase text-foreground" title="Written by an AI agent">AI</span>
                  </>
                ) : mine ? (
                  "You"
                ) : (
                  <><Avatar value={senderUser?.avatar} /> {senderUser?.display_name ?? "Someone"}</>
                )}
                {/* Flagged by the community spam guard: shown to moderators only. */}
                {canModerate &&
                  (meta.flags ?? []).filter((f) => FLAG_LABEL[f]).map((f) => (
                    <span key={f} className="rounded bg-danger/10 px-1 text-[10px] text-danger" data-testid={`flag-${f}`} title="Flagged by the community's automatic checks">
                      {FLAG_LABEL[f]}
                    </span>
                  ))}
                {isPrivate && (
                  <span className="text-[10px]" data-testid="private-label" title={byId.get(agent.id)?.type === "business" ? "Only your business team can see this message" : "Only you can see this message"}>
                    · 🔒 {byId.get(agent.id)?.type === "business" ? "only visible to your team" : "only visible to you"}
                  </span>
                )}
                <span className="ml-2 shrink-0 whitespace-nowrap text-[10px] tabular-nums opacity-70" data-testid="message-timestamp"><LocalTime iso={m.created_at} /></span>
                {!m.removed_at && !m.visible_to && outgoingReceiptIds.has(m.id) && <MessageReceipt messageId={m.id} summary={receipts.get(m.id)} />}
              </span>
              <div className={`flex ${hasMedia ? "w-[85%] max-w-md" : "max-w-[85%]"} items-start gap-1 ${mine ? "flex-row-reverse" : ""}`}>
                <div
                  className={`min-w-0 rounded-2xl ${hasMedia ? "flex-1 p-1.5" : "whitespace-pre-wrap px-3 py-2"} text-sm ${isPrivate ? "border border-dashed opacity-90" : ""} ${
                    m.removed_at
                      ? "border border-border italic text-muted"
                      : m.is_ai_generated
                        ? "border border-agent-border bg-agent"
                        : mine
                          ? "bg-accent text-white dark:text-black"
                          : "border border-border bg-surface"
                  }`}
                  data-message-bubble=""
                  data-outgoing-human={mine && !m.is_ai_generated ? "true" : undefined}
                  data-seen-message={!m.removed_at ? m.id : undefined}
                  data-testid={m.deleted_at ? "deleted-message" : isPrivate ? "private-message" : m.removed_at ? "removed-message" : undefined}
                >
                  {m.reply_to && !m.removed_at && (
                    <QuoteBlock
                      targetId={m.reply_to}
                      author={quoted ? authorOf(quoted) : ""}
                      snippet={quoted ? quoteSnippet(quoted.content) : ""}
                      ai={Boolean(quoted && quoteAttribution(quoted, "").ai)}
                      state={quoteState}
                    />
                  )}
                  {meta.forwarded && !m.removed_at && (
                    <span className="mb-0.5 block text-[11px] italic opacity-80" data-testid="forwarded-label">
                      {forwardLabel(meta.forwarded)}
                    </span>
                  )}
                  {meta.forwarded?.origin_author && !m.removed_at && <span className="mb-1 block text-[11px] opacity-80" data-testid="forward-origin">{meta.forwarded.origin_author}{meta.forwarded.origin_ai && !meta.forwarded.from_ai && " · AI"}{meta.forwarded.origin_at && <> · <LocalTime iso={meta.forwarded.origin_at} /></>}</span>}
                  {meta.kind === "forwarded_snapshot" && !m.removed_at && <p className="mb-2 text-xs font-semibold opacity-80" data-testid="shared-snapshot">Read-only copy · {(m.metadata as { snapshot?: { label?: string } }).snapshot?.label ?? "Message"}{(m.metadata as { snapshot?: { at?: string } }).snapshot?.at && <> · <LocalTime iso={(m.metadata as { snapshot: { at: string } }).snapshot.at} /></>}</p>}
                  {m.deleted_at ? <>Message deleted on <LocalTime iso={m.deleted_at} /></> : hasMedia ? <>
                    <MessageMedia files={messageFiles} location={sharedLocation} />
                    {m.content && <div className="whitespace-pre-wrap break-words px-1.5 pb-1 pt-2" data-testid="attachment-caption">{m.is_ai_generated ? <RichText text={m.content} /> : <MentionText text={m.content} mentions={(bundle.mentions ?? []).filter((mention) => mention.message_id === m.id)} agents={bundle.agents} />}</div>}
                  </> : m.is_ai_generated && !m.removed_at ? <RichText text={m.content} /> : <MentionText text={m.content} mentions={(bundle.mentions ?? []).filter((mention) => mention.message_id === m.id)} agents={bundle.agents} />}
                </div>
                {showActions && (
                  // With a mouse: ↩ Reply · ↪ Forward · ⋯ appear on hover. On phones: ⋯ (with everything in it).
                  <div className={`msg-actions flex items-center gap-0.5 self-center ${mine ? "flex-row-reverse" : ""}`}>
                    {replyTarget && <ReplyButton conversationId={id} target={replyTarget} />}
                    {reactOk && <ReactionButton />}
                    {forwardOk && <ForwardIcon messageId={m.id} />}
                    <MessageActions
                      messageId={m.id}
                      conversationId={id}
                      canReport={!isMyAgent && !mine && !isPrivate}
                      localReportDestination={conv.kind === "group" ? "group" : conv.kind === "channel" ? "community" : undefined}
                      canRemove={shared && !isPrivate && (mine || canModerate)}
                      canDelete={canDelete}
                      privateMessage={isPrivate}
                      canForward={forwardOk}
                      reply={replyTarget}
                    />
                  </div>
                )}
              </div>
              {sources.length > 0 && !m.removed_at && (
                <p className="mt-1 flex max-w-[85%] flex-wrap gap-x-3 gap-y-1 text-xs" data-testid="sources">
                  {sources.map((s) => (
                    <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline">
                      🔗 {(s.title || s.url!.replace(/^https?:\/\/(www\.)?/i, "")).slice(0, 60)}
                    </a>
                  ))}
                </p>
              )}
              {m.removed_at && meta.auto_hidden && mine && <HiddenAppeal messageId={m.id} conversationId={id} status={meta.appeal} />}
              {meta.kind === "draft" && meta.draft && <DraftReply conversationId={id} messageId={m.id} draft={meta.draft} sent={Boolean(meta.sent)} />}
              {meta.kind === "fact_suggestion" && isMyAgent && <FactSuggestion messageId={m.id} decided={meta.decided} />}
              {meta.kind === "business_suggestion" && isMyAgent && <BusinessSuggestion messageId={m.id} handle={meta.handle ?? ""} decided={meta.decided} />}
              {isMyAgent && !m.removed_at && m.is_ai_generated && Array.isArray(meta.booking_ways) && <BusinessWays ways={currentActions.get(meta.booking_business_id ?? legacyIdentities.get(m.id) ?? "")?.reservation ?? []} primary={false} agentId={meta.booking_business_id ?? legacyIdentities.get(m.id)} source="recall" />}
              {meta.handoff_offer && !m.removed_at && (isMyAgent || conv.kind === "agent_chat" || meta.asked_by === user.id) && <AskTeam messageId={m.id} sent={Boolean(meta.handoff_sent)} />}
              {meta.kind === "business_answer" && isMyAgent && meta.business_id && (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span data-testid="continue-with-business">
                    <ActionButton action={openAgentChat.bind(null, meta.business_id)} label={`💬 Continue with @${meta.handle ?? "them"}`} />
                  </span>
                  {/* Passing it on is yours to do: labelled as forwarded, from the business's agent. */}
                  {!isPrivate && forwardOk && <ForwardButton messageId={m.id} />}
                </div>
              )}
              {conv.kind === "agent_chat" && !mine && !isPrivate && !m.removed_at && forwardOk && (
                <div className="mt-1">
                  <ForwardButton messageId={m.id} />
                </div>
              )}
              <fieldset disabled={bundle.suspended || bundle.canManageBusiness === false} className="contents">
              {task && (
                <TaskCard
                  task={task as TaskView}
                  exchanges={(exchanges ?? []).filter((e) => e.task_id === task.id)}
                  steps={(steps ?? []).filter((s) => s.task_id === task.id)}
                  agents={byId}
                  canAct={isPlanOwner(task.id)}
                  participation={isMyAgent ? { responses: stepResponses ?? [], claims: claims ?? [], myAgentId: agent.id, myHandle: agent.handle, myFacts: myFacts ?? [] } : undefined}
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
                  venueWays={currentActions.get((proposal as ProposalView).content.venue?.agent_id ?? "")?.all ?? []}
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
              {isMyAgent && pollStep && tasks?.find((t) => t.id === pollStep.task_id)?.group_conversation_id && <Link href={`/chats/${tasks.find((t) => t.id === pollStep.task_id)!.group_conversation_id}`} className="mt-2 text-xs text-accent underline">Open poll chat →</Link>}
              </fieldset>
              {!isPrivate && !m.removed_at && <ReactionChips />}
            </li></MessageReactions>
          );
        })}

  </>;
}
