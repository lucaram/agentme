import { ActionButton } from "@/components/ActionButton";
import { CATEGORY_LABELS, type FactCategory } from "@/lib/policy/disclosure";
import { displayClock } from "@/lib/coordination/heuristics";
import { draftFromSteps } from "@/lib/plans/compose";
import type { TaskParsed } from "@/lib/plans/types";
import type { Database } from "@/lib/database.types";
import { approveTaskAction, cancelTaskAction, continueWithoutWaitingAction } from "../../actions";
import { DraftEditor } from "./DraftEditor";

export type TaskView = Database["public"]["Tables"]["tasks"]["Row"] & { parsed: TaskParsed };
type Exchange = Database["public"]["Tables"]["task_exchanges"]["Row"];
type StepRow = Database["public"]["Tables"]["plan_steps"]["Row"];
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

const HEADINGS: Record<NonNullable<TaskParsed["kind"]>, string> = {
  coordinate: "🗂️ Agent coordination",
  rsvp: "📨 Invitation",
  poll: "📊 Poll",
  question: "💬 Question",
  assign: "🧺 Sign-up list",
  announce: "📣 Announcement",
  composed: "🧩 Plan",
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

const STEP_ICON: Record<string, string> = {
  collect: "🗓️",
  proposal: "📝",
  rsvp: "📨",
  poll: "📊",
  question: "💬",
  assign: "🧺",
  announce: "📣",
};

/** One line per step, so the organiser sees exactly what will happen before approving. */
function StepLine({ step, parsed, hasProposal }: { step: StepRow; parsed: TaskParsed; hasProposal: boolean }) {
  const c = (step.config ?? {}) as Record<string, unknown>;
  const list = (v: unknown) => ((v as string[]) ?? []).join(" · ");
  const limits = [c.min && `at least ${c.min}`, c.max && `max ${c.max} (then a waitlist)`].filter(Boolean).join(", ");
  let body: React.ReactNode;
  switch (step.type) {
    case "collect":
      body = (
        <>
          Ask their agents for {((c.categories as string[]) ?? []).map((x) => CATEGORY_LABELS[x as FactCategory]?.toLowerCase() ?? x).join(" and ")} for{" "}
          {parsed.event} ({parsed.window}). Nothing else is shared.
        </>
      );
      break;
    case "proposal":
      body = "Draft a plan for you to approve before anyone sees it.";
      break;
    case "rsvp":
      body = hasProposal ? (
        <>Ask who&apos;s in once you share it{limits && <> (<span data-testid="rsvp-limits">{limits}</span>)</>}.</>
      ) : (
        <>
          Invite everyone to {String(c.title ?? parsed.event)}, {String(c.day ?? parsed.window)}
          {c.time ? ` at ${displayClock(String(c.time))}` : ""} and ask who&apos;s in
          {limits && <> (<span data-testid="rsvp-limits">{limits}</span>)</>}.
        </>
      );
      break;
    case "poll":
      body = (
        <>
          Everyone votes: “{String(c.question)}” <span data-testid="poll-options">{list(c.options)}</span>
        </>
      );
      break;
    case "question":
      body = <>Ask each of them personally: “{String(c.question)}”</>;
      break;
    case "assign":
      body = (
        <>
          Sign-up list: <span data-testid="assign-items">{list(c.items)}</span>. Everyone claims their own.
        </>
      );
      break;
    case "announce":
      body = <>Send your exact words as your own message: “{String(c.message)}”</>;
      break;
    default:
      body = step.type;
  }
  const done = step.status === "done" ? " ✓" : step.status === "waiting" ? " ⏳" : "";
  return (
    <li className="text-xs" data-testid={`step-${step.type}`}>
      {STEP_ICON[step.type] ?? "•"} {body}
      <span className="text-muted">{done}</span>
    </li>
  );
}

export function TaskCard({
  task,
  exchanges,
  steps,
  agents,
  canAct,
}: {
  task: TaskView;
  exchanges: Exchange[];
  steps: StepRow[];
  agents: Map<string, AgentLite>;
  canAct: boolean;
}) {
  const kind = task.parsed.kind ?? "coordinate";
  const ordered = [...steps].sort((a, b) => a.position - b.position);
  // Plans made before the step engine only have a migrated RSVP step: show
  // their original "find a time -> proposal -> who's in" flow from what was saved.
  const legacy = (task.parsed.kind ?? "coordinate") === "coordinate" && !ordered.some((s) => s.type === "collect");
  const hasProposal = legacy || ordered.some((s) => s.type === "proposal");
  // Retried/interrupted attempts stay in History; the card shows the latest per person.
  const latest = [...new Map(exchanges.map((e) => [e.to_agent ?? e.id, e])).values()];
  const editable = canAct && task.status === "awaiting_approval";

  return (
    <section className="mt-2 w-full max-w-[85%] rounded-2xl border border-agent-border bg-surface p-3 text-sm" aria-label="Agent task">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">
          {HEADINGS[kind]}
          {kind === "composed" && task.parsed.event ? `: ${task.parsed.event}` : ""}
        </span>
        <span className={`shrink-0 text-xs ${task.status === "failed" ? "text-danger" : "text-muted"}`} data-testid="task-status">
          {STATUS[task.status]}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted">{kind === "coordinate" ? "Agents" : "People"}</dt>
        <dd>{task.parsed.participants.map((h) => `@${h}`).join(", ")}</dd>
      </dl>
      <ol className="mt-2 space-y-1" aria-label="Steps">
        {legacy && (
          <>
            <li className="text-xs" data-testid="step-collect">
              🗓️ Ask their agents for {(task.parsed.categories ?? []).map((x) => CATEGORY_LABELS[x as FactCategory]?.toLowerCase() ?? x).join(" and ") || "availability"} for{" "}
              {task.parsed.event} ({task.parsed.window}).
            </li>
            <li className="text-xs" data-testid="step-proposal">📝 Draft a plan for you to approve before anyone sees it.</li>
          </>
        )}
        {ordered.map((s) => (
          <StepLine key={s.id} step={s} parsed={task.parsed} hasProposal={hasProposal} />
        ))}
      </ol>

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

      {ordered.some((s) => s.type === "collect") && latest.some((e) => e.status === "completed" && e.skill === "coordination.availability") && (
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
      {editable && <DraftEditor taskId={task.id} initial={draftFromSteps(task.parsed.event, ordered, task.parsed)} />}
    </section>
  );
}
