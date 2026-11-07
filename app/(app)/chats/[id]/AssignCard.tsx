import type { Database } from "@/lib/database.types";
import type { AssignConfig } from "@/lib/plans/blocks/assign";
import { ActionButton } from "@/components/ActionButton";
import { claimItemAction, unclaimItemAction } from "../../actions";

type StepRow = Database["public"]["Tables"]["plan_steps"]["Row"];
type Claim = Database["public"]["Tables"]["item_claims"]["Row"];
type AgentLite = { handle: string; avatar: string };

/** Sign-up list: everyone claims their own items; an item can only have one taker. */
export function AssignCard({
  step,
  claims,
  agents,
  myAgentId,
  myHandle,
}: {
  step: StepRow;
  claims: Claim[];
  agents: Map<string, AgentLite>;
  myAgentId: string;
  myHandle: string;
}) {
  const config = step.config as unknown as AssignConfig;
  const canClaim = config.people.includes(myHandle);
  const covered = config.items.filter((item) => claims.some((c) => c.item === item)).length;

  return (
    <section className="mt-2 w-full max-w-[85%] rounded-2xl border-2 border-accent bg-surface p-4 text-sm" aria-label="Sign-up list" data-testid="assign">
      <p className="text-xs uppercase tracking-wide text-muted">Sign-up list</p>
      <h3 className="mt-1 text-base font-semibold">{config.title}</h3>
      <ul className="mt-2 space-y-1.5">
        {config.items.map((item) => {
          const claim = claims.find((c) => c.item === item);
          const taker = claim ? agents.get(claim.agent_id) : undefined;
          const mine = claim?.agent_id === myAgentId;
          return (
            <li key={item} className="flex items-center justify-between gap-2" data-testid={`item-${item}`}>
              <span>
                {item}
                {claim ? (
                  <span className="ml-2 text-xs text-muted">
                    — {taker?.avatar} {mine ? "you" : `@${taker?.handle ?? "someone"}`}
                  </span>
                ) : (
                  <span className="ml-2 text-xs text-muted">— open</span>
                )}
              </span>
              {mine ? (
                <ActionButton action={unclaimItemAction.bind(null, step.id, item)} label="Give back" />
              ) : (
                !claim && canClaim && <ActionButton action={claimItemAction.bind(null, step.id, item)} label="I'll take it" variant="btn-primary" />
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-muted" data-testid="assign-progress">
        {covered === config.items.length ? "Everything is covered ✅" : `${covered} of ${config.items.length} covered`} · Nobody is assigned anything they didn&apos;t pick.
      </p>
    </section>
  );
}
