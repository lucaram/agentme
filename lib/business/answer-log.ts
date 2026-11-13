import "server-only";
import { adminClient } from "@/lib/supabase/admin";

/**
 * How each question to a business's agent was answered: from what it had read
 * ("knowledge"), from a page found by its address ("index") or by searching the
 * business's own website ("search"), by the team ("team"), or not at all
 * ("none"). Only the step is kept, never the question.
 */
export type AnswerStep = "knowledge" | "index" | "search" | "team" | "none";
export const ANSWER_STEPS: readonly AnswerStep[] = ["knowledge", "index", "search", "team", "none"];
const KEEP_DAYS = 90;

export async function logAnswer(agentId: string, step: AnswerStep) {
  const { error } = await adminClient().from("business_answer_log").insert({ agent_id: agentId, step });
  if (error) console.error("answer log unavailable", error.message);
}

/** Counts per step over the last `days` days. */
export async function answerStats(agentId: string, days = 30): Promise<Record<AnswerStep, number>> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const db = adminClient();
  const counts = await Promise.all(
    ANSWER_STEPS.map(async (step) => {
      const { count } = await db.from("business_answer_log").select("id", { count: "exact", head: true }).eq("agent_id", agentId).eq("step", step).gte("created_at", since);
      return [step, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(counts) as Record<AnswerStep, number>;
}

/** "Last 30 days: 120 questions · 102 answered from what it knows · 12 found on your website · 6 sent to your team". */
export function statsLine(stats: Record<AnswerStep, number>, days = 30): string | null {
  const total = ANSWER_STEPS.reduce((n, s) => n + stats[s], 0);
  if (!total) return null;
  const found = stats.index + stats.search;
  const parts = [
    `${stats.knowledge} answered from what it knows`,
    found ? `${found} found on your website` : "",
    stats.team ? `${stats.team} sent to your team` : "",
    stats.none ? `${stats.none} not answered` : "",
  ].filter(Boolean);
  return `Last ${days} days: ${total} ${total === 1 ? "question" : "questions"} · ${parts.join(" · ")}`;
}

/** Old entries go (called by the sweeper). */
export async function pruneAnswerLog() {
  await adminClient().from("business_answer_log").delete().lt("created_at", new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString());
}
