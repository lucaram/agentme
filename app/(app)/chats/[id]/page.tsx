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

export default async function ChatPage({ params }: PageProps<"/chats/[id]">) {
  const { id } = await params;
  const { user, agent } = await requireAgent();
  const supabase = await createClient();

  // All reads use the user's session: RLS decides what is visible.
  const { data: conv } = await supabase.from("conversations").select("*, conversation_members(user_id)").eq("id", id).maybeSingle();
  if (!conv) notFound();
  // Seen now (database clock). The client also re-marks when new messages arrive while open.
  await supabase.rpc("mark_conversation_read", { p_conversation: id });

  const [{ data: messages }, { data: agents }] = await Promise.all([
    supabase.from("messages").select("*").eq("conversation_id", id).order("created_at").limit(200),
    supabase.from("agents").select("id, owner_id, handle, display_name, avatar, type"),
  ]);
  const byId = new Map((agents ?? []).map((a) => [a.id, a]));
  const byOwner = new Map((agents ?? []).map((a) => [a.owner_id, a]));

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

  // Template chips for My Agent, filled with the owner's own contacts.
  let examples: { label: string; text: string }[] | undefined;
  if (conv.kind === "my_agent") {
    const { data: contacts } = await supabase.from("contacts").select("requester_agent, addressee_agent").eq("status", "accepted");
    const friends = (contacts ?? [])
      .map((c) => byId.get(c.requester_agent === agent.id ? c.addressee_agent : c.requester_agent))
      .filter((a) => a && a.type === "personal")
      .map((a) => `@${a!.handle}`);
    const [a, b] = [friends[0] ?? "@friend", friends[1] ?? friends[0] ?? "@friend"];
    const both = a === b ? a : `${a} and ${b}`;
    examples = [
      { label: "🍝 Dinner", text: `Arrange dinner with ${both} on Saturday evening` },
      { label: "⚽ Five-a-side", text: `Organise five-a-side on Thursday at 7pm with ${both}, need 3, someone bring a ball and bibs` },
      { label: "📊 Poll", text: `Ask ${both} to vote: Italian, Thai or Indian` },
      { label: "🧺 Who brings what", text: `Ask ${both} who brings what for Saturday: drinks, dessert and bread` },
      { label: "🚗 Carpool", text: `Ask ${both} who drives which day: Monday, Tuesday, Wednesday` },
      { label: "💬 Question", text: `Ask ${a} if they can help me move on Sunday` },
      { label: "📣 Announcement", text: `Tell ${both}: the trip is tomorrow, bring lunch` },
    ];
  }
  const others = conv.conversation_members.filter((m) => m.user_id !== user.id).map((m) => byOwner.get(m.user_id));
  const title =
    conv.kind === "my_agent"
      ? "My Agent"
      : conv.kind === "agent_chat"
        ? `${target?.avatar ?? ""} ${target?.display_name ?? "Agent"} (@${target?.handle})`
        : conv.title ?? others.map((o) => o?.display_name).join(", ");
  const subtitle =
    conv.kind === "my_agent"
      ? "Ask your agent to organise something with your contacts. It always asks before contacting anyone."
      : conv.kind === "agent_chat"
        ? "You're talking to an AI agent over A2A. It answers only from information its owner published."
        : conv.kind === "group"
          ? `Members: ${["you", ...others.map((o) => (o ? `@${o.handle}` : "someone"))].join(", ")}`
          : "Direct message";

  return (
    <div className="flex flex-1 flex-col">
      {/* Seeing the chat (including messages that arrive while it is open) clears its unread counter. */}
      <MarkRead conversationId={id} latestMessageId={(messages ?? []).at(-1)?.id ?? null} />
      <RealtimeRefresh
        channel={`conv-${id}`}
        tables={["messages", "tasks", "task_exchanges", "proposals", "plan_steps", "step_responses", "item_claims"]}
        filter={`conversation_id=eq.${id}`}
      />
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="text-xs text-muted">{subtitle}</p>
        </div>
        {conv.kind !== "my_agent" && (
          <form action={leaveConversation.bind(null, id)}>
            <button className="text-xs text-muted hover:text-danger">{conv.kind === "agent_chat" ? "Delete chat" : "Leave"}</button>
          </form>
        )}
      </div>

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
              <li key={m.id} className={`text-center text-xs ${meta.kind === "error" ? "text-danger" : "text-muted"}`}>{m.content}</li>
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
                    {senderAgent?.avatar} {senderAgent ? `@${senderAgent.handle}'s agent` : "An agent"}
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
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${isPrivate ? "border border-dashed opacity-90" : ""} ${
                  m.is_ai_generated ? "border border-agent-border bg-agent" : mine ? "bg-accent text-white dark:text-black" : "border border-border bg-surface"
                }`}
                data-testid={isPrivate ? "private-message" : undefined}
              >
                {m.is_ai_generated ? <RichText text={m.content} /> : m.content}
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

      <Composer
        conversationId={id}
        placeholder={
          conv.kind === "my_agent"
            ? "e.g. Arrange dinner with @marco and @paul on Saturday evening"
            : conv.kind === "agent_chat"
              ? `Ask @${target?.handle ?? "agent"} a question`
              : "Message — or @agent to ask your agent (only you see it)"
        }
        thinkingLabel={conv.kind === "dm" || conv.kind === "group" ? undefined : "Agent is thinking…"}
        examples={examples}
      />
    </div>
  );
}
