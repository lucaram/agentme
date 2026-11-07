import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { postMessage } from "@/lib/data/chat";
import { ensurePlanGroup } from "../group";
import type { PollConfig } from "../poll";
import type { StepHandler } from "../types";

/**
 * Poll block: shares the organiser-approved question and options in the plan's
 * group, then waits. People vote themselves (their agent may only suggest);
 * code counts. The step finishes when everyone has voted or the organiser
 * closes the poll (see lib/plans/actions.ts).
 */
export const runPoll: StepHandler = async ({ task, step, organiser }) => {
  if ((step.result as { closed?: boolean } | null)?.closed) return { kind: "done", result: step.result };

  const config = step.config as unknown as PollConfig;
  const group = await ensurePlanGroup(task, config.voters.filter((h) => h !== organiser.handle), config.question);

  const { data: posted } = await adminClient()
    .from("messages")
    .select("id")
    .eq("conversation_id", group.id)
    .eq("metadata->>step_id", step.id)
    .limit(1);
  if (!posted?.length) {
    await postMessage({
      conversationId: group.id,
      from: "agent",
      agentId: organiser.id,
      content: `📊 Poll: ${config.question} Options: ${config.options.join(" · ")}`,
      metadata: { kind: "poll", step_id: step.id, task_id: task.id },
    });
    await postMessage({
      conversationId: task.conversation_id,
      from: "agent",
      agentId: organiser.id,
      content: `I've shared the poll in the “${group.title ?? config.question}” group. I'll tell you the result when everyone has voted, or you can close it early from the group.`,
      metadata: { kind: "info", task_id: task.id },
    });
  }
  return { kind: "waiting", taskStatus: "waiting" };
};
