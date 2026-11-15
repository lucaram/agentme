import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { forwardText } from "./forward";

type Client = Awaited<ReturnType<typeof createClient>>;
type Message = { content: string; is_ai_generated: boolean; metadata: unknown };
export type ShareSnapshot = { label: string; at: string };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown) => typeof value === "string" ? value.slice(0, 2000) : "";
const list = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 30) : [];
const LABELS: Record<string, string> = { task_card: "Approval / plan", proposal: "Suggested plan", poll: "Poll", rsvp: "Invitation", assign: "Sign-up list", question: "Question", fact_suggestion: "Suggested answer", business_suggestion: "Business suggestion", draft: "Draft message" };

async function responses(db: Client, stepId: string) {
  const { data: answers } = await db.from("step_responses").select("agent_id,value,updated_at").eq("step_id", stepId).order("updated_at").order("agent_id");
  const { data: people } = answers?.length ? await db.from("agents").select("id,display_name,handle").in("id", answers.map((answer) => answer.agent_id)) : { data: [] };
  return (answers ?? []).slice(0, 40).map((answer) => { const person = people?.find((entry) => entry.id === answer.agent_id); const value = record(answer.value); return `${person?.display_name ?? "Someone"}${person ? ` (@${person.handle})` : ""}: ${str(value.option) || str(value.response)} · ${answer.updated_at}`; }).concat((answers?.length ?? 0) > 40 ? [`${answers!.length - 40} more responses`] : []);
}

/** Authenticated reads only. Deliberately excludes private coordination exchanges and all live IDs/actions. */
export async function shareSnapshot(db: Client, message: Message): Promise<{ text: string; snapshot?: ShareSnapshot }> {
  const meta = record(message.metadata); const kind = str(meta.kind);
  if (kind === "forwarded_snapshot") return { text: message.content, snapshot: { label: str(record(meta.snapshot).label) || "Message", at: str(record(meta.snapshot).at) } };
  const label = LABELS[kind]; if (!label) return { text: forwardText(message) };
  let lines = [message.content];
  if (kind === "poll" || kind === "assign") {
    const { data: step } = await db.from("plan_steps").select("id,type,config,status").eq("id", str(meta.step_id)).maybeSingle();
    if (step) {
      const config = record(step.config);
      if (kind === "poll") {
        const { data: votes } = await db.from("step_responses").select("value").eq("step_id", step.id);
        const question = str(config.question);
        lines = [message.content !== question ? message.content : "", `Poll: ${question}`, ...list(config.options).map((option) => `${option}: ${(votes ?? []).filter((vote) => record(vote.value).option === option).length} votes`), step.status === "done" ? "Closed" : "Open", ...(await responses(db, step.id))];
      } else {
        const { data: claims } = await db.from("item_claims").select("item,agent_id,created_at").eq("step_id", step.id);
        const { data: people } = claims?.length ? await db.from("agents").select("id,display_name,handle").in("id", claims.map((claim) => claim.agent_id)) : { data: [] };
        lines.push(...list(config.items).map((item) => { const claim = claims?.find((entry) => entry.item === item); const person = people?.find((entry) => entry.id === claim?.agent_id); return `• ${item}: ${claim ? `${person?.display_name ?? "Participant"}${person ? ` (@${person.handle})` : ""} · ${claim.created_at}` : "Available"}`; }), `Status: ${step.status}`);
      }
    }
  } else if (kind === "proposal") {
    const { data: proposal } = await db.from("proposals").select("task_id,content,status").eq("id", str(meta.proposal_id)).maybeSingle();
    if (proposal) {
      const content = record(proposal.content); const venue = record(content.venue);
      lines.push(str(content.title), [str(content.day), str(content.time)].filter(Boolean).join(" at "), str(venue.name) ? `Venue: ${str(venue.name)}` : "", str(content.cuisine), `People: ${list(content.participants).map((person) => `@${person}`).join(", ")}`, `Status: ${proposal.status}`, str(content.rationale), str(content.disclaimer));
      const { data: rsvp } = await db.from("plan_steps").select("id").eq("task_id", proposal.task_id).eq("type", "rsvp").limit(1).maybeSingle();
      if (rsvp) lines.push(...await responses(db, rsvp.id));
    }
  } else if (kind === "task_card") {
    const { data: task } = await db.from("tasks").select("goal,status,parsed").eq("id", str(meta.task_id)).maybeSingle();
    if (task) { const parsed = record(task.parsed); lines.push(task.goal, str(parsed.window), `Status: ${task.status.replace(/_/g, " ")}`); }
  } else if (kind === "draft") lines.push(str(meta.draft));
  const text = lines.filter(Boolean).join("\n\n"); const shortened = "\n\n… Snapshot shortened to fit a message.";
  return { text: text.length > 8000 ? text.slice(0, 8000 - shortened.length) + shortened : text, snapshot: { label, at: new Date().toISOString() } };
}
