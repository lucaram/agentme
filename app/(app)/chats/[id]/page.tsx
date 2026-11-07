import { notFound } from "next/navigation";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { Composer } from "./Composer";
import { TaskCard, type TaskView } from "./TaskCard";
import { ProposalCard, type ProposalView } from "./ProposalCard";
import { leaveConversation } from "../../actions";

export default async function ChatPage({ params }: PageProps<"/chats/[id]">) {
  const { id } = await params;
  const { user, agent } = await requireAgent();
  const supabase = await createClient();

  // All reads use the user's session: RLS decides what is visible.
  const { data: conv } = await supabase.from("conversations").select("*, conversation_members(user_id)").eq("id", id).maybeSingle();
  if (!conv) notFound();

  const [{ data: messages }, { data: agents }] = await Promise.all([
    supabase.from("messages").select("*").eq("conversation_id", id).order("created_at").limit(200),
    supabase.from("agents").select("id, owner_id, handle, display_name, avatar, type"),
  ]);
  const byId = new Map((agents ?? []).map((a) => [a.id, a]));
  const byOwner = new Map((agents ?? []).map((a) => [a.owner_id, a]));

  const taskIds = (messages ?? []).map((m) => (m.metadata as { task_id?: string }).task_id).filter(Boolean) as string[];
  const proposalIds = (messages ?? []).map((m) => (m.metadata as { proposal_id?: string }).proposal_id).filter(Boolean) as string[];

  const [{ data: tasks }, { data: exchanges }, { data: proposals }, { data: responses }] = await Promise.all([
    taskIds.length ? supabase.from("tasks").select("*").in("id", taskIds) : Promise.resolve({ data: [] }),
    taskIds.length ? supabase.from("task_exchanges").select("*").in("task_id", taskIds).order("created_at") : Promise.resolve({ data: [] }),
    proposalIds.length ? supabase.from("proposals").select("*").in("id", proposalIds) : Promise.resolve({ data: [] }),
    proposalIds.length ? supabase.from("proposal_responses").select("*").in("proposal_id", proposalIds) : Promise.resolve({ data: [] }),
  ]);

  const target = conv.target_agent ? byId.get(conv.target_agent) : undefined;
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
      <RealtimeRefresh
        channel={`conv-${id}`}
        tables={["messages", "tasks", "task_exchanges", "proposals", "proposal_responses"]}
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
          const meta = m.metadata as { kind?: string; task_id?: string; proposal_id?: string };
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
              </span>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                  m.is_ai_generated ? "border border-agent-border bg-agent" : mine ? "bg-accent text-white dark:text-black" : "border border-border bg-surface"
                }`}
              >
                {m.content}
              </div>
              {task && (
                <TaskCard
                  task={task as TaskView}
                  exchanges={(exchanges ?? []).filter((e) => e.task_id === task.id)}
                  agents={byId}
                  canAct={task.owner_id === user.id}
                />
              )}
              {proposal && (
                <ProposalCard
                  proposal={proposal as ProposalView}
                  responses={(responses ?? []).filter((r) => r.proposal_id === proposal.id)}
                  agents={byId}
                  myAgentId={agent.id}
                  myHandle={agent.handle}
                  inGroup={conv.kind === "group"}
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
              : "Message"
        }
        thinkingLabel={conv.kind === "dm" || conv.kind === "group" ? undefined : "Agent is thinking…"}
      />
    </div>
  );
}
