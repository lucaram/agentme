import "server-only";
import { postMessage } from "@/lib/data/chat";
import type { AgentRow } from "@/lib/data/agents";

type Plan = { id: string; conversation_id: string; group_conversation_id: string | null };

/** Human actions stay visible in the shared chat and the organiser's request. */
export async function recordPlanAction(task: Plan, actor: Pick<AgentRow, "id" | "handle" | "display_name">, action: string, content: string, stepId?: string) {
  for (const conversationId of new Set([task.group_conversation_id, task.conversation_id])) {
    if (!conversationId) continue;
    await postMessage({ conversationId, from: "system", content,
      metadata: { kind: "event", task_id: task.id, ...(stepId ? { step_id: stepId } : {}), action, actor: { agent_id: actor.id, handle: actor.handle, name: actor.display_name } },
    });
  }
}
