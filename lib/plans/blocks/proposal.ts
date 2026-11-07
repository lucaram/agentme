import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { llm } from "@/lib/llm";
import { asJson } from "@/lib/data/json";
import { getFacts } from "@/lib/data/agents";
import { postMessage } from "@/lib/data/chat";
import { PROPOSAL_SYSTEM, wrapUntrusted } from "@/lib/agents/prompts";
import { displayClock, heuristicPlan, relevantClause, type ParticipantReply } from "@/lib/coordination/heuristics";
import { DISCLAIMER, ProposalSchema, type Proposal } from "@/lib/coordination/schemas";
import { validateProposal } from "@/lib/coordination/validate";
import type { StepHandler, TaskParsed } from "../types";
import type { CollectResult } from "./collect";

/**
 * Proposal block: the organiser's agent drafts a plan from what was collected,
 * code validates it, and the organiser must approve it (the step waits).
 */
export const runProposal: StepHandler = async ({ task, organiser, parsed, results, renew }) => {
  const db = adminClient();

  // Already drafted on an earlier run? Then we're only waiting for the decision.
  let { data: saved } = await db.from("proposals").select("id, content, status").eq("task_id", task.id).maybeSingle();
  if (saved && saved.status !== "pending") return { kind: "done", result: { proposalId: saved.id, decision: saved.status } };

  if (!saved) {
    const collected = (results.collect as CollectResult | undefined)?.replies ?? [];
    // The organiser's own preferences: the owner's own agent may use them for the owner.
    const ownFacts = await getFacts(organiser.id);
    const ownAvailability = ownFacts.find((f) => f.category === "availability")?.value ?? null;
    const own: ParticipantReply = {
      handle: organiser.handle,
      availability: ownAvailability ? relevantClause(ownAvailability, parsed.window) : null,
      food: ownFacts.find((f) => f.category === "food")?.value ?? null,
    };

    const proposal = await draftProposal(organiser.handle, [own, ...collected], parsed);
    if (!proposal) return { kind: "failed", error: "I couldn't find a time that works for everyone." };
    await renew();
    const inserted = await db
      .from("proposals")
      .insert({ task_id: task.id, content: asJson({ ...proposal, disclaimer: DISCLAIMER }) })
      .select("id, content, status")
      .single();
    // Unique violation: a concurrent worker saved one first. Use it.
    saved = inserted.error ? (await db.from("proposals").select("id, content, status").eq("task_id", task.id).single()).data : inserted.data;
    if (!saved) return { kind: "failed", error: "could not save the proposal" };
  }

  const content = saved.content as unknown as Proposal;
  await postProposalOnce(task.conversation_id, saved.id, task.id, organiser.id, content);
  return { kind: "waiting", taskStatus: "proposal_ready" };
};

async function postProposalOnce(conversationId: string, proposalId: string, taskId: string, agentId: string, content: Proposal) {
  const { data } = await adminClient()
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("metadata->>proposal_id", proposalId)
    .limit(1);
  if (data?.length) return;
  await postMessage({
    conversationId,
    from: "agent",
    agentId,
    content: `Here's a suggested plan: ${content.title}, ${content.day} at ${displayClock(content.time)}. ${DISCLAIMER}`,
    metadata: { kind: "proposal", proposal_id: proposalId, task_id: taskId },
  });
}

async function draftProposal(organiser: string, replies: ParticipantReply[], parsed: TaskParsed): Promise<Proposal | null> {
  const repliesBlock = wrapUntrusted("untrusted_replies", JSON.stringify(replies, null, 2));
  const ask = `Organiser: @${organiser}\nEvent: ${parsed.event}\nWindow: ${parsed.window}\n\n${repliesBlock}`;
  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const proposal = await llm().generateObject({
        purpose: "proposal",
        tier: "smart",
        system: PROPOSAL_SYSTEM,
        messages: [{ role: "user", content: ask + feedback }],
        schema: ProposalSchema,
        maxTokens: 2000,
        mockContext: { organiser, replies, event: parsed.event, window: parsed.window },
      });
      const check = validateProposal(proposal, organiser, replies);
      if (check.ok) return proposal;
      feedback = `\n\nYour previous proposal was invalid: ${check.problems.join(" ")} Fix these problems.`;
    } catch {
      break;
    }
  }
  // Deterministic fallback, still validated.
  const fallback = heuristicPlan(organiser, replies, parsed.event, parsed.window);
  return validateProposal(fallback, organiser, replies).ok ? fallback : null;
}
