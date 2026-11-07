import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import type { StepHandler } from "../types";

/**
 * RSVP block (v2). Opens "in / can't make it" on the shared plan. Answers are
 * always each person's own action and stay editable; this step doesn't block
 * the plan. After a proposal, sharing it counts as the organiser's "in".
 */
export const runRsvp: StepHandler = async ({ step, organiser, results }) => {
  const proposal = results.proposal as { decision?: string } | undefined;
  if (proposal && proposal.decision !== "accepted") return { kind: "done", result: { open: false } };
  await adminClient()
    .from("step_responses")
    .upsert(
      { step_id: step.id, agent_id: organiser.id, answered_by: "human", value: { response: "in" } },
      { onConflict: "step_id,agent_id", ignoreDuplicates: true },
    );
  return { kind: "done", result: { open: true } };
};
