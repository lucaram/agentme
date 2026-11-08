import { ActionButton } from "@/components/ActionButton";
import { displayClock } from "@/lib/coordination/heuristics";
import { evaluate } from "@/lib/plans/threshold";
import type { Database } from "@/lib/database.types";
import { decideProposalAction } from "../../actions";
import { RsvpControl } from "./RsvpControl";
import { ChangePlanForm } from "./ChangePlanForm";
import { BusinessWays } from "@/components/BusinessWays";
import type { Way } from "@/lib/business/booking";

export type ProposalView = Database["public"]["Tables"]["proposals"]["Row"] & {
  content: {
    title: string;
    day: string;
    time: string;
    cuisine: string | null;
    participants: string[];
    rationale: string;
    disclaimer: string;
    /** A business @mentioned in the request: the place. */
    venue?: { agent_id: string; handle: string; name: string } | null;
  };
};
type StepResponse = Database["public"]["Tables"]["step_responses"]["Row"];
type AgentLite = { handle: string; avatar: string };

export function ProposalCard({
  proposal,
  rsvpStepId,
  rsvpConfig,
  responses,
  agents,
  myAgentId,
  myHandle,
  inGroup,
  canChange,
  venueWays = [],
}: {
  proposal: ProposalView;
  rsvpStepId: string | null;
  rsvpConfig: { min?: number | null; max?: number | null };
  responses: StepResponse[];
  agents: Map<string, AgentLite>;
  myAgentId: string;
  myHandle: string;
  inGroup: boolean;
  canChange: boolean;
  /** The venue's own ways to book or order (loaded on the server). */
  venueWays?: Way[];
}) {
  const c = proposal.content;
  const isOrganiserView = !inGroup;
  const handleOf = (agentId: string) => agents.get(agentId)?.handle ?? "";
  const avatarOf = (handle: string) => [...agents.values()].find((a) => a.handle === handle)?.avatar;
  // Code decides who's going and who's waitlisted (in the order they said yes).
  const state = evaluate(
    responses.map((r) => ({ handle: handleOf(r.agent_id), response: (r.value as { response: "in" | "out" }).response, at: r.updated_at })),
    rsvpConfig,
  );
  const mine = responses.find((r) => r.agent_id === myAgentId);
  const myResponse = (mine?.value as { response?: "in" | "out" } | undefined)?.response ?? null;
  const statusOf = (handle: string) =>
    state.going.includes(handle) ? "✅ in" : state.waitlist.includes(handle) ? `🕒 waitlist #${state.waitlist.indexOf(handle) + 1}` : state.out.includes(handle) ? "❌ can't make it" : null;

  return (
    <section className="mt-2 w-full max-w-[85%] rounded-2xl border-2 border-accent bg-surface p-4 text-sm" aria-label="Proposal" data-testid="proposal">
      <p className="text-xs uppercase tracking-wide text-muted">{c.rationale ? "Suggested plan" : "Plan"}</p>
      <h3 className="mt-1 text-base font-semibold" data-testid="plan-title">{c.title}</h3>
      <p className="mt-1" data-testid="plan-when">
        📅 {c.day}
        {c.time ? `, ${displayClock(c.time)}` : ""}
        {c.cuisine && <> · 🍽️ {c.cuisine}</>} · 👥 {c.participants.length} people
      </p>
      <p className="mt-1 text-xs text-muted">{c.participants.map((p) => `@${p}`).join(", ")}</p>
      {c.rationale && <p className="mt-2 text-xs text-muted">{c.rationale}</p>}
      <p className="mt-2 rounded-lg bg-accent-soft px-2 py-1 text-xs">{c.disclaimer}</p>
      {c.venue && (
        <div className="mt-2 space-y-1 rounded-lg border border-border p-2" data-testid="plan-venue">
          <p className="text-xs">
            📍 At <a className="font-medium text-accent underline" href={`/u/${c.venue.handle}`}>{c.venue.name}</a>
            {venueWays.length ? `: book or order directly with ${c.venue.name}` : ` (@${c.venue.handle})`}
          </p>
          <BusinessWays ways={venueWays} />
        </div>
      )}

      {proposal.status === "accepted" && (
        <>
          {(rsvpConfig.min || rsvpConfig.max) && (
            <p className="mt-2 text-xs font-medium" data-testid="threshold">
              {rsvpConfig.min ? (state.on ? `✅ It's on — ${state.going.length} of ${rsvpConfig.min} needed are in` : `⏳ ${state.going.length} of ${rsvpConfig.min} needed are in`) : `${state.going.length} in`}
              {rsvpConfig.max ? ` · ${Math.max(0, rsvpConfig.max - state.going.length)} of ${rsvpConfig.max} places left` : ""}
              {state.waitlist.length ? ` · ${state.waitlist.length} on the waitlist` : ""}
            </p>
          )}
          <ul className="mt-2 space-y-0.5 text-xs" aria-label="Who's in" data-testid="rsvps">
            {c.participants.map((handle) => (
              <li key={handle}>
                {avatarOf(handle)} @{handle}: {statusOf(handle) ?? <span className="text-muted">⏳ waiting</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-3 flex flex-wrap items-start gap-2">
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
      {canChange && <ChangePlanForm proposalId={proposal.id} title={c.title} day={c.day} time={c.time} />}
    </section>
  );
}
