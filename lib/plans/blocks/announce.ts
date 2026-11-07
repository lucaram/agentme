import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { postMessage } from "@/lib/data/chat";
import { ensurePlanGroup } from "../group";
import type { StepHandler } from "../types";

export type AnnounceConfig = { message: string; participants: string[] };

/**
 * Announce block: information only. The organiser approved the exact words,
 * so it is sent as THEIR message (not AI-written) in its own group.
 */
export const runAnnounce: StepHandler = async ({ task, step, organiser }) => {
  const config = step.config as unknown as AnnounceConfig;
  const title = `📣 ${config.message.length > 40 ? `${config.message.slice(0, 39)}…` : config.message}`;
  const group = await ensurePlanGroup(task, config.participants, title);

  const { data: posted } = await adminClient().from("messages").select("id").eq("conversation_id", group.id).eq("metadata->>step_id", step.id).limit(1);
  if (!posted?.length) {
    await postMessage({
      conversationId: group.id,
      from: "human",
      userId: task.owner_id,
      content: config.message,
      metadata: { kind: "announcement", step_id: step.id, task_id: task.id },
    });
    await postMessage({
      conversationId: task.conversation_id,
      from: "agent",
      agentId: organiser.id,
      content: `Sent your message to everyone in “${group.title ?? title}”.`,
      metadata: { kind: "info", task_id: task.id },
    });
  }
  return { kind: "done", result: { sent: true } };
};
