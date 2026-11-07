import { ActionButton } from "@/components/ActionButton";
import { CATEGORY_LABELS, type FactCategory } from "@/lib/policy/disclosure";
import type { Database } from "@/lib/database.types";
import { approveTaskAction, cancelTaskAction, continueWithoutWaitingAction } from "../../actions";

export type TaskView = Database["public"]["Tables"]["tasks"]["Row"] & {
  parsed: {
    kind?: "coordinate" | "poll" | "question";
    event: string;
    window: string;
    participants: string[];
    categories: string[];
    question?: string;
    options?: string[];
  };
};
type Exchange = Database["public"]["Tables"]["task_exchanges"]["Row"];
type AgentLite = { handle: string; avatar: string };

const STATUS: Record<TaskView["status"], string> = {
  awaiting_approval: "Waiting for your approval",
  running: "Agents are coordinating…",
  waiting: "Waiting for people to answer",
  proposal_ready: "Proposal ready",
  accepted: "Plan shared",
  completed: "Done",
  rejected: "Plan dropped",
  cancelled: "Stopped",
  failed: "Failed",
};

function exchangeLabel(e: Exchange, handle: string | undefined): string {
  switch (e.status) {
    case "pending":
      return "⏳ asking…";
    case "waiting_human":
      return `· ⏳ asked @${handle ?? "them"} personally, waiting for their answer`;
    case "completed":
      return e.answered_by === "human" ? `· answered by @${handle ?? "them"} personally` : "· replied automatically";
    case "refused":
      return e.answered_by === "human" ? "🚫 preferred not to share" : "🚫 refused to share";
    case "failed":
      return "⚠️ no reply";
  }
}

export function TaskCard({
  task,
  exchanges,
  agents,
  canAct,
}: {
  task: TaskView;
  exchanges: Exchange[];
  agents: Map<string, AgentLite>;
  canAct: boolean;
}) {
  const kind = task.parsed.kind ?? "coordinate";
  const asks = task.parsed.categories.map((c) => CATEGORY_LABELS[c as FactCategory] ?? c).join(", ");
  const heading = kind === "poll" ? "📊 Poll" : kind === "question" ? "💬 Question" : "🗂️ Agent coordination";
  // Retried/interrupted attempts stay in History; the card shows the latest per person.
  const latest = [...new Map(exchanges.map((e) => [e.to_agent ?? e.id, e])).values()];
  return (
    <section className="mt-2 w-full max-w-[85%] rounded-2xl border border-agent-border bg-surface p-3 text-sm" aria-label="Agent task">
      <div className="flex items-center justify-between">
        <span className="font-medium">{heading}</span>
        <span className={`text-xs ${task.status === "failed" ? "text-danger" : "text-muted"}`} data-testid="task-status">
          {STATUS[task.status]}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted">{kind === "coordinate" ? "Agents" : "People"}</dt>
        <dd>{task.parsed.participants.map((h) => `@${h}`).join(", ")}</dd>
        {kind === "coordinate" && (
          <>
            <dt className="text-muted">Will ask for</dt>
            <dd>{asks}</dd>
            <dt className="text-muted">When</dt>
            <dd>{task.parsed.window}</dd>
          </>
        )}
        {kind !== "coordinate" && (
          <>
            <dt className="text-muted">{kind === "poll" ? "Vote on" : "Question"}</dt>
            <dd>“{task.parsed.question}”</dd>
          </>
        )}
        {kind === "poll" && (
          <>
            <dt className="text-muted">Options</dt>
            <dd data-testid="poll-options">{(task.parsed.options ?? []).join(" · ")}</dd>
          </>
        )}
      </dl>

      {latest.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-border pt-2">
          {latest.map((e) => {
            const to = e.to_agent ? agents.get(e.to_agent) : undefined;
            const reply = e.response as { data?: { availability?: string | null; food?: string | null; answer?: string }; text?: string } | null;
            return (
              <li key={e.id} className="text-xs" data-testid="exchange">
                <span className="font-medium">{to?.avatar} @{to?.handle}&apos;s agent</span> {exchangeLabel(e, to?.handle)}
                {e.status === "completed" && reply?.data && (
                  <span className="block pl-5 text-muted">
                    {reply.data.answer
                      ? `“${reply.data.answer}”`
                      : [reply.data.availability && `Available: ${reply.data.availability}`, reply.data.food && `Food: ${reply.data.food}`]
                          .filter(Boolean)
                          .join(" · ") || reply.text}
                  </span>
                )}
                {(e.status === "failed" || e.status === "refused") && e.error && <span className="block pl-5 text-muted">{e.error}</span>}
              </li>
            );
          })}
        </ul>
      )}

      {kind === "coordinate" && latest.some((e) => e.status === "completed") && (
        <p className="mt-2 text-[11px] text-muted">
          Agents answer within what their owners allowed them to share; anything else is asked to the person. Nobody has agreed to anything yet.
        </p>
      )}
      {task.error && <p className="mt-2 text-xs text-danger">{task.error}</p>}

      {canAct && (
        <div className="mt-3 flex flex-wrap gap-2">
          {task.status === "awaiting_approval" && (
            <ActionButton action={approveTaskAction.bind(null, task.id)} label="Approve" pendingLabel="Starting…" variant="btn-primary" />
          )}
          {task.status === "waiting" && (
            <ActionButton action={continueWithoutWaitingAction.bind(null, task.id)} label="Continue without waiting" pendingLabel="Continuing…" />
          )}
          {["awaiting_approval", "running", "waiting"].includes(task.status) && (
            <ActionButton action={cancelTaskAction.bind(null, task.id)} label={task.status === "awaiting_approval" ? "Cancel" : "Stop"} />
          )}
        </div>
      )}
    </section>
  );
}
