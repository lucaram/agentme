import "server-only";
import { z } from "zod";
import { adminClient } from "@/lib/supabase/admin";
import { asJson } from "@/lib/data/json";
import { getAgentById, getFacts } from "@/lib/data/agents";
import { postMessage } from "@/lib/data/chat";
import { displayClock, relevantClause, type ParticipantReply } from "@/lib/coordination/heuristics";
import { validateProposal } from "@/lib/coordination/validate";
import type { Proposal } from "@/lib/coordination/schemas";
import type { CollectResult } from "./blocks/collect";
import { privateResultOf } from "./steps";

const ChangeInput = z.object({
  title: z.string().trim().min(1, "Give the plan a name.").max(120),
  day: z.string().trim().min(1, "Say which day.").max(40),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Pick a time."),
});
export type ChangeInputT = z.infer<typeof ChangeInput>;

type Result = { ok: true; warnings: string[] } | { ok: false; error: string };

const when = (c: { day: string; time: string }) => `${c.day}${c.time ? ` at ${displayClock(c.time)}` : ""}`;

/**
 * Change block: the organiser edits an agreed (shared) plan. Every change is
 * kept in plan_changes. If the day or time changed, everyone's RSVP goes back
 * to "waiting" (except the organiser's) and they're asked to confirm again.
 * The organiser gets a heads-up if the new time conflicts with what agents said.
 */
export async function changePlan(proposalId: string, userId: string, input: ChangeInputT): Promise<Result> {
  const parsed = ChangeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const db = adminClient();
  const { data: proposal } = await db.from("proposals").select("*, tasks(*)").eq("id", proposalId).maybeSingle();
  const task = proposal?.tasks;
  if (!proposal || !task || task.owner_id !== userId) return { ok: false, error: "Not found." };
  if (proposal.status !== "accepted") return { ok: false, error: "Only a shared plan can be changed." };

  const before = proposal.content as unknown as Proposal & { disclaimer: string };
  const after = { ...before, title: parsed.data.title, day: parsed.data.day, time: parsed.data.time };
  const timingChanged = after.day !== before.day || after.time !== before.time;
  if (!timingChanged && after.title === before.title) return { ok: true, warnings: [] };

  const organiser = await getAgentById(task.initiator_agent);
  await db.from("plan_changes").insert({
    task_id: task.id,
    changed_by: task.initiator_agent,
    before: asJson({ title: before.title, day: before.day, time: before.time }),
    after: asJson({ title: after.title, day: after.day, time: after.time }),
    reset_rsvps: timingChanged,
  });
  await db.from("proposals").update({ content: asJson(after) }).eq("id", proposalId);

  if (timingChanged) {
    // Everyone affected re-confirms; the organiser made the change, so stays in.
    const { data: rsvp } = await db.from("plan_steps").select("id").eq("task_id", task.id).eq("type", "rsvp").maybeSingle();
    if (rsvp) await db.from("step_responses").delete().eq("step_id", rsvp.id).neq("agent_id", task.initiator_agent);
  }

  // Heads-up if the new time clashes with what the agents said (code check, not AI).
  const warnings: string[] = [];
  if (timingChanged && organiser) {
    // What the agents replied is kept where only the server reads (never in the row group members can read).
    const replies = ((await privateResultOf(task.id, "collect")) as CollectResult | null)?.replies ?? [];
    if (replies.length) {
      const facts = await getFacts(organiser.id);
      const ownAvailability = facts.find((f) => f.category === "availability")?.value ?? null;
      const own: ParticipantReply = { handle: organiser.handle, availability: ownAvailability ? relevantClause(ownAvailability, after.day) : null, food: null };
      const check = validateProposal(after, organiser.handle, [own, ...replies]);
      if (!check.ok) warnings.push(...check.problems);
    }
  }

  const name = organiser?.display_name ?? "The organiser";
  if (task.group_conversation_id) {
    await postMessage({
      conversationId: task.group_conversation_id,
      from: "system",
      content: timingChanged
        ? `${name} changed the plan: ${after.title}, ${when(after)} (was ${when(before)}). Please confirm again.`
        : `${name} renamed the plan to “${after.title}”.`,
      metadata: { kind: "event", proposal_id: proposalId },
    });
  }
  await postMessage({
    conversationId: task.conversation_id,
    from: "agent",
    agentId: task.initiator_agent,
    content: `Updated the plan: ${after.title}, ${when(after)}.${timingChanged ? " Everyone has been asked to confirm again." : ""}${
      warnings.length ? ` Heads-up: ${warnings.join(" ")}` : ""
    }`,
    metadata: { kind: "info", task_id: task.id },
  });
  return { ok: true, warnings };
}
