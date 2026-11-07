import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { displayClock } from "@/lib/coordination/heuristics";
import type { RecallPlan } from "./recall-format";
import { evaluate, type ThresholdConfig } from "@/lib/plans/threshold";

export type { RecallPlan } from "./recall-format";

/**
 * Recall: a compact summary of the plans the owner can already see (ones they
 * organised, and ones shared with them in a group), so their agent can answer
 * "what time did we agree?" or "who hasn't replied?". Built only from data the
 * owner has access to: nothing new is disclosed.
 */
export async function buildRecall(userId: string): Promise<RecallPlan[]> {
  const db = adminClient();
  const { data: memberships } = await db.from("conversation_members").select("conversation_id").eq("user_id", userId);
  const groupIds = (memberships ?? []).map((m) => m.conversation_id);

  const owned = (await db.from("tasks").select("*").eq("owner_id", userId).order("created_at", { ascending: false }).limit(10)).data ?? [];
  const shared = groupIds.length
    ? (await db.from("tasks").select("*").in("group_conversation_id", groupIds).neq("owner_id", userId).order("created_at", { ascending: false }).limit(10)).data ?? []
    : [];
  const tasks = [...owned, ...shared].filter((t) => !["cancelled", "awaiting_approval"].includes(t.status));
  if (!tasks.length) return [];

  const taskIds = tasks.map((t) => t.id);
  const [{ data: agents }, { data: proposals }, { data: steps }] = await Promise.all([
    db.from("agents").select("id, handle"),
    db.from("proposals").select("task_id, content, status").in("task_id", taskIds),
    db.from("plan_steps").select("id, task_id, type, config, result, status").in("task_id", taskIds),
  ]);
  const stepIds = (steps ?? []).filter((s) => s.type === "rsvp" || s.type === "poll").map((s) => s.id);
  const assignIds = (steps ?? []).filter((s) => s.type === "assign").map((s) => s.id);
  const [{ data: responses }, { data: claims }] = await Promise.all([
    stepIds.length ? db.from("step_responses").select("step_id, agent_id, value, updated_at").in("step_id", stepIds) : Promise.resolve({ data: [] }),
    assignIds.length ? db.from("item_claims").select("step_id, item, agent_id").in("step_id", assignIds) : Promise.resolve({ data: [] }),
  ]);
  const handleOf = new Map((agents ?? []).map((a) => [a.id, a.handle]));

  return tasks.map((t): RecallPlan => {
    const parsed = t.parsed as { kind?: string; event?: string; window?: string; participants?: string[]; question?: string };
    const organiser = handleOf.get(t.initiator_agent) ?? "someone";
    const everyone = [organiser, ...(parsed.participants ?? [])];
    const plan: RecallPlan = {
      kind: parsed.kind ?? "coordinate",
      title: parsed.question ?? parsed.event ?? t.goal,
      organiser,
      status: t.status,
      createdAt: t.created_at,
    };
    const proposal = (proposals ?? []).find((p) => p.task_id === t.id);
    if (proposal) {
      const c = proposal.content as { title: string; day: string; time: string; participants: string[] };
      plan.title = c.title;
      plan.when = `${c.day} at ${displayClock(c.time)}`;
    }
    for (const step of (steps ?? []).filter((s) => s.task_id === t.id)) {
      const answers = (responses ?? []).filter((r) => r.step_id === step.id);
      const byHandle = new Map(answers.map((r) => [handleOf.get(r.agent_id) ?? "", r.value as Record<string, string>]));
      if (step.type === "rsvp") {
        const cfg = (step.config ?? {}) as ThresholdConfig;
        const state = evaluate(
          answers.map((r) => ({ handle: handleOf.get(r.agent_id) ?? "", response: (r.value as { response: "in" | "out" }).response, at: r.updated_at })),
          cfg,
        );
        plan.rsvp = {
          in: state.going,
          out: state.out,
          waiting: everyone.filter((h) => !byHandle.has(h)),
          waitlist: state.waitlist,
          min: cfg.min ?? null,
        };
      }
      if (step.type === "assign") {
        const config = step.config as { title: string; items: string[] };
        plan.title = config.title;
        plan.assign = config.items.map((item) => {
          const claim = (claims ?? []).find((c) => c.step_id === step.id && c.item === item);
          return { item, by: claim ? handleOf.get(claim.agent_id) ?? null : null };
        });
      }
      if (step.type === "poll") {
        const config = step.config as { question: string; options: string[]; voters: string[] };
        const result = (step.result ?? {}) as { closed?: boolean; winners?: string[] };
        const counts = Object.fromEntries(config.options.map((o) => [o, 0]));
        for (const v of byHandle.values()) if (v.option in counts) counts[v.option] += 1;
        plan.title = config.question;
        plan.poll = {
          question: config.question,
          counts,
          closed: Boolean(result.closed),
          winners: result.winners ?? [],
          notVoted: config.voters.filter((h) => !byHandle.has(h)),
        };
      }
      if (step.type === "question") {
        const result = (step.result ?? { answers: {} }) as { answers: Record<string, { status: string; answer?: string }> };
        const config = step.config as { participants: string[] };
        plan.answers = config.participants.map((h) => ({
          handle: h,
          status: result.answers[h]?.status ?? "waiting",
          answer: result.answers[h]?.answer ?? null,
        }));
      }
    }
    return plan;
  });
}
