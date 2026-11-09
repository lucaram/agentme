import { ActionButton } from "@/components/ActionButton";
import { CATEGORY_LABELS, type FactCategory } from "@/lib/policy/disclosure";
import { displayClock } from "@/lib/coordination/heuristics";
import { draftFromSteps } from "@/lib/plans/compose";
import { stepWords } from "@/lib/plans/wording";
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
  ask_around: "🔎 Ask around",
};

type Tone = "waiting" | "personal" | "auto" | "no";
const TONE: Record<Tone, string> = {
  waiting: "border border-border text-muted",
  personal: "bg-accent text-white dark:text-black",
  auto: "bg-accent-soft text-accent",
  no: "border border-danger text-danger",
};

function replyStatus(e: Exchange, handle: string | undefined): { label: string; tone: Tone } {
  const who = `@${handle ?? "them"}`;
  switch (e.status) {
    case "pending":
      return { label: "⏳ asking…", tone: "waiting" };
    case "waiting_human":
      return { label: `⏳ asked ${who} personally, waiting for their answer`, tone: "waiting" };
    case "completed":
      if (e.skill === "coordination.ask_around") {
        return e.answered_by === "human" ? { label: "💡 tip", tone: "personal" } : { label: "💡 saved tip", tone: "auto" };
      }
      return e.answered_by === "human" ? { label: `👤 answered by ${who} personally`, tone: "personal" } : { label: "🤖 replied automatically", tone: "auto" };
    case "refused":
      return { label: e.answered_by === "human" ? "🚫 preferred not to share" : "🚫 refused to share", tone: "no" };
    case "failed":
      return { label: "⚠️ no reply", tone: "no" };
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
  ask_around: "🔎",
};

/** One line per step, so the organiser sees exactly what will happen before approving. */
/** inChat: the plan runs in an existing chat (started there with "@agent"). */
function StepLine({ step, parsed, hasProposal, inChat }: { step: StepRow; parsed: TaskParsed; hasProposal: boolean; inChat: boolean }) {
  const c = (step.config ?? {}) as Record<string, unknown>;
  const people = parsed.participants ?? [];
  const list = (v: unknown) => ((v as string[]) ?? []).join(" · ");
  const limits = [c.min && `at least ${c.min}`, c.max && `max ${c.max} (then a waitlist)`].filter(Boolean).join(", ");
  let body: React.ReactNode;
  switch (step.type) {
    case "collect":
      body = (
        <>
          {stepWords.collect(people)} {((c.categories as string[]) ?? []).map((x) => CATEGORY_LABELS[x as FactCategory]?.toLowerCase() ?? x).join(" and ")} for{" "}
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
          {stepWords.invite(people)} {String(c.title ?? parsed.event)}, {String(c.day ?? parsed.window)}
          {c.time ? ` at ${displayClock(String(c.time))}` : ""} and ask who&apos;s in
          {limits && <> (<span data-testid="rsvp-limits">{limits}</span>)</>}.
        </>
      );
      break;
    case "poll":
      body = (
        <>
          {stepWords.vote(people)}: “{String(c.question)}” <span data-testid="poll-options">{list(c.options)}</span>
        </>
      );
      break;
    case "question":
      body = <>{stepWords.question(people)}: “{String(c.question)}”</>;
      break;
    case "assign":
      body = (
        <>
          Sign-up list: <span data-testid="assign-items">{list(c.items)}</span>. {stepWords.claim(people)}.
        </>
      );
      break;
    case "announce":
      // To one person: your direct chat with them (or the chat it was started in). To several: a new group.
      body =
        people.length === 1 ? (
          <>
            Send to @{people[0]} {inChat ? "in this chat" : "in your direct chat"}, as your own message: “{String(c.message)}”
          </>
        ) : (
          <>Send your exact words as your own message: “{String(c.message)}”</>
        );
      break;
    case "ask_around":
      body = <>{stepWords.askAround(people)}: “{String(c.question)}”</>;
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
  const allLatest = [...new Map(exchanges.map((e) => [e.to_agent ?? e.id, e])).values()];
  const askAround = kind === "ask_around";
  const latest = askAround ? allLatest.filter((e) => e.status === "completed") : allLatest;
  const editable = canAct && task.status === "awaiting_approval";

  return (
    <section className="mt-2 w-full max-w-[85%] rounded-2xl border border-agent-border bg-surface p-3 text-sm" aria-label="Agent task">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">
          {HEADINGS[kind]}
          {kind === "composed" && task.parsed.event ? `: ${task.parsed.event}` : ""}
        </span>
        <span className={`shrink-0 text-xs ${task.status === "failed" ? "text-danger" : "text-muted"}`} data-testid="task-status">
          {task.status === "waiting" && (task.parsed.participants ?? []).length === 1
            ? `Waiting for @${task.parsed.participants[0]} to answer`
            : STATUS[task.status]}
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
              🗓️ {stepWords.collect(task.parsed.participants ?? [])} {(task.parsed.categories ?? []).map((x) => CATEGORY_LABELS[x as FactCategory]?.toLowerCase() ?? x).join(" and ") || "availability"} for{" "}
              {task.parsed.event} ({task.parsed.window}).
            </li>
            <li className="text-xs" data-testid="step-proposal">📝 Draft a plan for you to approve before anyone sees it.</li>
          </>
        )}
        {ordered.map((s) => (
          <StepLine key={s.id} step={s} parsed={task.parsed} hasProposal={hasProposal} inChat={Boolean(task.group_conversation_id)} />
        ))}
      </ol>

      {askAround && task.status !== "awaiting_approval" && (
        <p className="mt-3 border-t border-border pt-2 text-xs text-muted" data-testid="ask-around-progress">
          Asked {task.parsed.participants.length} {task.parsed.participants.length === 1 ? "friend" : "friends"} · {latest.length}{" "}
          {latest.length === 1 ? "tip" : "tips"} so far
        </p>
      )}
      {latest.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{askAround ? "Tips" : "Replies"}</h3>
          <ul className="space-y-2">
            {latest.map((e) => {
              const to = e.to_agent ? agents.get(e.to_agent) : undefined;
              const reply = e.response as { data?: { availability?: string | null; food?: string | null; answer?: string }; text?: string } | null;
              const status = replyStatus(e, to?.handle);
              const details =
                e.status === "completed" && reply?.data && !reply.data.answer
                  ? [reply.data.availability && `🗓️ ${reply.data.availability}`, reply.data.food && `🍽️ ${reply.data.food}`].filter(Boolean)
                  : [];
              return (
                <li key={e.id} className="rounded-xl border border-border p-2.5" data-testid="exchange">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xl" aria-hidden>{to?.avatar}</span>
                    <span className="text-sm font-medium">@{to?.handle}&apos;s agent</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[status.tone]}`}>{status.label}</span>
                  </div>
                  {e.status === "completed" && reply?.data?.answer && (
                    <p className="mt-2 rounded-lg border-l-4 border-accent bg-accent-soft px-3 py-2 text-base" data-testid="reply-answer">
                      “{reply.data.answer}”
                    </p>
                  )}
                  {details.length > 0 && (
                    <p className="mt-2 space-x-3 rounded-lg border-l-4 border-accent bg-accent-soft px-3 py-2 text-sm">
                      {details.map((d) => (
                        <span key={String(d)}>{d}</span>
                      ))}
                    </p>
                  )}
                  {e.status === "completed" && reply?.data && !reply.data.answer && !details.length && reply.text && <p className="mt-1 text-sm text-muted">{reply.text}</p>}
                  {(e.status === "failed" || e.status === "refused") && e.error && <p className="mt-1 text-xs text-muted">{e.error}</p>}
                </li>
              );
            })}
          </ul>
        </div>
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
            <ActionButton
              action={continueWithoutWaitingAction.bind(null, task.id)}
              label={askAround ? "✨ Summarise now" : "Continue without waiting"}
              pendingLabel={askAround ? "Summarising…" : "Continuing…"}
            />
          )}
          {["awaiting_approval", "running", "waiting"].includes(task.status) && (
            <ActionButton action={cancelTaskAction.bind(null, task.id)} label={task.status === "awaiting_approval" ? "Cancel" : "Stop"} />
          )}
        </div>
      )}
      {editable && !askAround && <DraftEditor taskId={task.id} initial={draftFromSteps(task.parsed.event, ordered, task.parsed)} />}
    </section>
  );
}
