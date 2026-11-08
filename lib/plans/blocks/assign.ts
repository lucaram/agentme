import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { postMessage } from "@/lib/data/chat";
import { ensurePlanGroup, whereShared } from "../group";
import type { StepHandler } from "../types";

export type AssignConfig = {
  title: string;
  items: string[];
  /** Everyone who may claim items, including the organiser. */
  people: string[];
};

/**
 * Assign block: a sign-up list in the plan's own group. People claim their own
 * items (never assigned by someone else); the database guarantees no item is
 * claimed twice. The step finishes when every item is covered.
 */
export const runAssign: StepHandler = async ({ task, step, organiser }) => {
  const db = adminClient();
  const config = step.config as unknown as AssignConfig;
  if ((step.result as { complete?: boolean } | null)?.complete) return { kind: "done", result: step.result };

  const group = await ensurePlanGroup(task, config.people.filter((h) => h !== organiser.handle), `🧺 ${config.title}`);
  const { data: posted } = await db.from("messages").select("id").eq("conversation_id", group.id).eq("metadata->>step_id", step.id).limit(1);
  if (!posted?.length) {
    await postMessage({
      conversationId: group.id,
      from: "agent",
      agentId: organiser.id,
      content: `🧺 ${config.title}: ${config.items.join(" · ")}. Claim what you'll bring or do.`,
      metadata: { kind: "assign", step_id: step.id, task_id: task.id },
    });
    await postMessage({
      conversationId: task.conversation_id,
      from: "agent",
      agentId: organiser.id,
      content: `I've shared the sign-up list in ${whereShared(group, config.title)}. I'll tell you when everything is covered.`,
      metadata: { kind: "info", task_id: task.id },
    });
  }

  const { count } = await db.from("item_claims").select("*", { count: "exact", head: true }).eq("step_id", step.id);
  if ((count ?? 0) >= config.items.length) return { kind: "done", result: { complete: true } };
  return { kind: "waiting", taskStatus: "waiting" };
};
