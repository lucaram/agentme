import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { asJson } from "@/lib/data/json";
import { postMessage } from "@/lib/data/chat";
import { DISCLAIMER } from "@/lib/coordination/schemas";
import { displayClock } from "@/lib/coordination/heuristics";
import { ensurePlanGroup, whereShared } from "../group";
import type { StepHandler } from "../types";

export type RsvpConfig = {
  /** Standalone invitations (no proposal step) describe the event here. */
  title?: string;
  day?: string;
  time?: string;
  /** Threshold: minimum people for it to happen / maximum places (waitlist beyond), including the organiser. */
  min?: number | null;
  max?: number | null;
};

/**
 * RSVP block (v2 + Threshold). Opens "in / can't make it" on the plan; answers
 * are always each person's own action and stay editable; this step doesn't
 * block the plan. After a proposal, sharing it counts as the organiser's "in".
 * For a standalone invitation (the organiser already fixed day and time), it
 * creates the plan card in its own group first.
 */
export const runRsvp: StepHandler = async ({ task, step, organiser, parsed, results }) => {
  const db = adminClient();
  const proposal = results.proposal as { decision?: string } | undefined;
  if (proposal && proposal.decision !== "accepted") return { kind: "done", result: { open: false } };

  if (!proposal) {
    // Standalone invitation: the plan card is the organiser's fixed event.
    const config = step.config as unknown as RsvpConfig;
    const title = config.title || parsed.event || "Plan";
    const content = {
      title,
      day: config.day || parsed.window,
      time: config.time ?? parsed.time ?? "",
      cuisine: null,
      participants: [organiser.handle, ...parsed.participants],
      rationale: "",
      disclaimer: DISCLAIMER,
      venue: parsed.venue ?? null,
    };
    let { data: saved } = await db.from("proposals").select("id, group_conversation_id").eq("task_id", task.id).maybeSingle();
    const group = await ensurePlanGroup(task, parsed.participants, title);
    if (!saved) {
      const inserted = await db
        .from("proposals")
        .insert({ task_id: task.id, content: asJson(content), status: "accepted", group_conversation_id: group.id })
        .select("id, group_conversation_id")
        .single();
      saved = inserted.error ? (await db.from("proposals").select("id, group_conversation_id").eq("task_id", task.id).single()).data : inserted.data;
    }
    if (!saved) return { kind: "failed", error: "could not create the invitation" };

    const { data: posted } = await db.from("messages").select("id").eq("conversation_id", group.id).eq("metadata->>proposal_id", saved.id).limit(1);
    if (!posted?.length) {
      const limits = [config.min && `needs at least ${config.min}`, config.max && `max ${config.max} places`].filter(Boolean).join(", ");
      await postMessage({
        conversationId: group.id,
        from: "agent",
        agentId: organiser.id,
        content: `You're invited: ${title}, ${content.day}${content.time ? ` at ${displayClock(content.time)}` : ""}.${limits ? ` (${limits})` : ""} Are you in?`,
        metadata: { kind: "proposal", proposal_id: saved.id, task_id: task.id },
      });
      await postMessage({
        conversationId: task.conversation_id,
        from: "agent",
        agentId: organiser.id,
        content: `I've invited everyone in ${whereShared(group, title)}. You're marked as in.`,
        metadata: { kind: "info", task_id: task.id },
      });
    }
  }

  await db
    .from("step_responses")
    .upsert(
      { step_id: step.id, agent_id: organiser.id, answered_by: "human", value: { response: "in" } },
      { onConflict: "step_id,agent_id", ignoreDuplicates: true },
    );
  return { kind: "done", result: { open: true } };
};
