import "server-only";
import { adminClient } from "@/lib/supabase/admin";

export type QuestionSummary = { question: string; asked: number; automatic: number; needed_team: number; unresolved: number };
export type DaySummary = { day: string; total: number; automatic: number; team: number; pending: number; unanswered: number; closed: number; redirected: number };
export type DashboardData = {
  days: number; start: string; end: string; pending: number; history_since: string | null; tracking_since: string; unlabelled: number;
  totals: { received: number; automatic: number; team: number; unanswered: number; closed: number; redirected: number; previous: number; previous_automatic: number };
  daily: DaySummary[]; questions: QuestionSummary[]; gaps: QuestionSummary[];
  clicks: { kind: string; label: string; clicks: number }[];
};
export const dashboardDays = (raw: unknown) => [7, 30, 90].includes(Number(raw)) ? Number(raw) : 30;

/** Called only after the page authorises the current business identity. */
export async function businessDashboard(agentId: string, days: number): Promise<DashboardData | null> {
  const { data, error } = await adminClient().rpc("business_dashboard", { p_agent: agentId, p_days: dashboardDays(days) });
  if (error || !data) return null;
  return data as unknown as DashboardData;
}
