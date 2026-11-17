import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import type { SessionUser } from "@/lib/auth";
import type { AgentRow } from "@/lib/data/agents";
import { reviewBusinessPublication } from "./handoff";
import { PUBLICATION_WARNINGS } from "./question-scope";
import { withUsageContext } from "@/lib/usage/context";

export async function staffControls(user: SessionUser, agent: AgentRow) {
  const result = await adminClient().from("business_managers").select("role,require_assignment,require_publication_approval").eq("business_agent_id", agent.id).eq("user_id", user.actorId ?? user.id).single();
  if (result.error || result.data.role !== "staff") throw new Error("Staff access unavailable.");
  return result.data;
}

/** Stable reason codes; uncertain/offline reviews must never be labelled privacy violations. */
export async function publicationWarning(user: SessionUser, agent: AgentRow, question: string, answer: string): Promise<string | undefined> {
  const decision = await withUsageContext({ userId: user.id, agentId: agent.id }, () => reviewBusinessPublication(question, answer));
  if (decision === "approved") return;
  const actor = user.actorId ?? user.id; const db = adminClient();
  const { data: person } = await db.from("agents").select("display_name").eq("owner_id", actor).maybeSingle();
  const reasons = { privacy: "Private or customer-specific details", not_answered: "Answer does not answer the question", uncertain: "Review could not confirm a reusable answer", unavailable: "Publication check unavailable" };
  await db.from("business_staff_audit").insert({ business_agent_id: agent.id, actor_id: actor, actor_name: person?.display_name ?? "Team member", subject_name: question.slice(0, 300), action: `Q&A publication check: ${decision} — ${reasons[decision]}` });
  return PUBLICATION_WARNINGS[decision];
}
