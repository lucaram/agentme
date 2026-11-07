import { ActionButton } from "@/components/ActionButton";
import { displayClock } from "@/lib/coordination/heuristics";
import type { Database } from "@/lib/database.types";
import { decideProposalAction } from "../../actions";
import { RsvpControl } from "./RsvpControl";

export type ProposalView = Database["public"]["Tables"]["proposals"]["Row"] & {
  content: { title: string; day: string; time: string; cuisine: string | null; participants: string[]; rationale: string; disclaimer: string };
};
type StepResponse = Database["public"]["Tables"]["step_responses"]["Row"];
type AgentLite = { handle: string; avatar: string };

export function ProposalCard({
  proposal,
  rsvpStepId,
  responses,
  agents,
  myAgentId,
  myHandle,
  inGroup,
}: {
  proposal: ProposalView;
  rsvpStepId: string | null;
  responses: StepResponse[];
  agents: Map<string, AgentLite>;
  myAgentId: string;
  myHandle: string;
  inGroup: boolean;
}) {
  const c = proposal.content;
  const isOrganiserView = !inGroup;
  const answerOf = (handle: string) => {
    const entry = [...agents.entries()].find(([, a]) => a.handle === handle);
    const r = entry ? responses.find((x) => x.agent_id === entry[0]) : undefined;
    return { avatar: entry?.[1].avatar, response: (r?.value as { response?: "in" | "out" } | undefined)?.response };
  };
  const mine = responses.find((r) => r.agent_id === myAgentId);
  const myResponse = (mine?.value as { response?: "in" | "out" } | undefined)?.response ?? null;

  return (
    <section className="mt-2 w-full max-w-[85%] rounded-2xl border-2 border-accent bg-surface p-4 text-sm" aria-label="Proposal" data-testid="proposal">
      <p className="text-xs uppercase tracking-wide text-muted">Suggested plan</p>
      <h3 className="mt-1 text-base font-semibold">{c.title}</h3>
      <p className="mt-1">
        📅 {c.day}, {displayClock(c.time)}
        {c.cuisine && <> · 🍽️ {c.cuisine}</>} · 👥 {c.participants.length} people
      </p>
      <p className="mt-1 text-xs text-muted">{c.participants.map((p) => `@${p}`).join(", ")}</p>
      <p className="mt-2 text-xs text-muted">{c.rationale}</p>
      <p className="mt-2 rounded-lg bg-accent-soft px-2 py-1 text-xs">{c.disclaimer}</p>

      {proposal.status === "accepted" && (
        <ul className="mt-2 space-y-0.5 text-xs" aria-label="Who's in" data-testid="rsvps">
          {c.participants.map((handle) => {
            const { avatar, response } = answerOf(handle);
            return (
              <li key={handle}>
                {avatar} @{handle}:{" "}
                {response === "in" ? "✅ in" : response === "out" ? "❌ can't make it" : <span className="text-muted">⏳ waiting</span>}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {isOrganiserView && proposal.status === "pending" && (
          <>
            <ActionButton action={decideProposalAction.bind(null, proposal.id, "accept")} label="Share with everyone" pendingLabel="Sharing…" variant="btn-primary" />
            <ActionButton action={decideProposalAction.bind(null, proposal.id, "reject")} label="Reject" />
          </>
        )}
        {isOrganiserView && proposal.status !== "pending" && (
          <span className="text-xs text-muted">{proposal.status === "accepted" ? "Shared in a group chat." : "Rejected."}</span>
        )}
        {inGroup && rsvpStepId && proposal.status === "accepted" && c.participants.includes(myHandle) && (
          <RsvpControl stepId={rsvpStepId} current={myResponse} />
        )}
      </div>
    </section>
  );
}
