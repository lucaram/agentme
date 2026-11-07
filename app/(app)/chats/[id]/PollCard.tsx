import type { Database } from "@/lib/database.types";
import { suggestVote, tally, type PollConfig } from "@/lib/plans/poll";
import { ActionButton } from "@/components/ActionButton";
import { closePollAction, voteAction } from "../../actions";

type StepRow = Database["public"]["Tables"]["plan_steps"]["Row"];
type StepResponse = Database["public"]["Tables"]["step_responses"]["Row"];
type AgentLite = { handle: string; avatar: string };

export function PollCard({
  step,
  votes,
  agents,
  myAgentId,
  myHandle,
  myFacts,
  isOrganiser,
}: {
  step: StepRow;
  votes: StepResponse[];
  agents: Map<string, AgentLite>;
  myAgentId: string;
  myHandle: string;
  myFacts: { category: string; value: string }[];
  isOrganiser: boolean;
}) {
  const config = step.config as unknown as PollConfig;
  const closed = step.status === "done" || Boolean((step.result as { closed?: boolean } | null)?.closed);
  const optionOf = (v: StepResponse) => (v.value as { option?: string }).option ?? "";
  const result = tally(config.options, votes.map(optionOf), config.voters.length);
  const mine = votes.find((v) => v.agent_id === myAgentId);
  const canVote = !closed && config.voters.includes(myHandle);
  // The viewer's own agent may SUGGEST a vote from the viewer's own preferences; the human decides.
  const suggestion = canVote && !mine ? suggestVote(config.options, myFacts) : null;
  const votersFor = (option: string) => votes.filter((v) => optionOf(v) === option).map((v) => agents.get(v.agent_id)?.avatar ?? "•");
  const notVoted = config.voters.filter((h) => ![...agents.entries()].some(([id, a]) => a.handle === h && votes.some((v) => v.agent_id === id)));

  return (
    <section className="mt-2 w-full max-w-[85%] rounded-2xl border-2 border-accent bg-surface p-4 text-sm" aria-label="Poll" data-testid="poll">
      <p className="text-xs uppercase tracking-wide text-muted">{closed ? "Poll closed" : "Poll"}</p>
      <h3 className="mt-1 text-base font-semibold">{config.question}</h3>
      {suggestion && (
        <p className="mt-1 rounded-lg bg-agent px-2 py-1 text-xs" data-testid="poll-suggestion">
          🤖 Your agent suggests <b>{suggestion.option}</b>, based on {suggestion.because}. You decide.
        </p>
      )}
      <ul className="mt-2 space-y-1.5">
        {config.options.map((option) => {
          const count = result.counts[option];
          const isMine = mine && optionOf(mine) === option;
          const isWinner = closed && result.winners.includes(option);
          return (
            <li key={option} className="flex items-center gap-2">
              {canVote ? (
                <ActionButton
                  action={voteAction.bind(null, step.id, option)}
                  label={`${isMine ? "✓ " : ""}${option}`}
                  variant={isMine ? "btn-primary" : "btn-ghost"}
                />
              ) : (
                <span className={`rounded-full border px-4 py-2 ${isWinner ? "border-accent font-semibold" : "border-border"}`}>
                  {isWinner ? "🏆 " : ""}
                  {option}
                </span>
              )}
              <span className="text-xs text-muted" data-testid={`poll-count-${option}`}>
                {count} vote{count === 1 ? "" : "s"} {votersFor(option).join(" ")}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-muted">
        {closed
          ? result.winners.length
            ? `Result: ${result.winners.join(" / ")}${result.winners.length > 1 ? " (tie)" : ""}`
            : "No votes."
          : `${result.votes} of ${config.voters.length} voted${notVoted.length ? ` · waiting for ${notVoted.map((h) => `@${h}`).join(", ")}` : ""}. Votes are counted by the app, not by AI.`}
      </p>
      {isOrganiser && !closed && (
        <div className="mt-2">
          <ActionButton action={closePollAction.bind(null, step.id)} label="Close poll now" />
        </div>
      )}
    </section>
  );
}
