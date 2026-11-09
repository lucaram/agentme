import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { createConversation, findConversation, postMessage } from "@/lib/data/chat";
import { getAgentByHandle, getContactRow, type AgentRow } from "@/lib/data/agents";
import { DM_CLOSED, dmState } from "@/lib/people/dm";
import { ensurePlanGroup, whereShared } from "../group";
import type { StepHandler, TaskRow } from "../types";

export type AnnounceConfig = { message: string; participants: string[] };

/**
 * Announce block: information only. The organiser approved the exact words,
 * so it is sent as THEIR message (not AI-written). To one person it goes in
 * your direct chat with them (started if needed); to several, in a new group;
 * a plan started inside a chat stays in that chat.
 */
export const runAnnounce: StepHandler = async ({ task, step, organiser }) => {
  const config = step.config as unknown as AnnounceConfig;
  const title = `📣 ${config.message.length > 40 ? `${config.message.slice(0, 39)}…` : config.message}`;

  let conversationId: string;
  let where: string;
  if (!task.group_conversation_id && config.participants.length === 1) {
    const direct = await directChat(task, organiser, config.participants[0]);
    if (!direct.ok) return { kind: "failed", error: direct.error };
    conversationId = direct.id;
    where = `@${config.participants[0]} in your direct chat`;
  } else {
    const group = await ensurePlanGroup(task, config.participants, title);
    conversationId = group.id;
    where = `everyone in ${whereShared(group, title)}`;
  }

  // Sent once, even if the step runs again.
  const { data: posted } = await adminClient().from("messages").select("id").eq("conversation_id", conversationId).eq("metadata->>step_id", step.id).limit(1);
  if (!posted?.length) {
    await postMessage({
      conversationId,
      from: "human",
      userId: task.owner_id,
      content: config.message,
      metadata: { kind: "announcement", step_id: step.id, task_id: task.id },
    });
    await postMessage({
      conversationId: task.conversation_id,
      from: "agent",
      agentId: organiser.id,
      content: `Sent your message to ${where}.`,
      metadata: { kind: "info", task_id: task.id },
    });
  }
  return { kind: "done", result: { sent: true } };
};

/** Your direct chat with one contact (started if you don't have one); never a chat that's closed. */
async function directChat(task: TaskRow, organiser: AgentRow, handle: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const other = await getAgentByHandle(handle);
  if (!other) return { ok: false, error: `@${handle} isn't on AGENTME any more.` };
  // Contacts only: checked again now, since things may have changed since you made the plan.
  if ((await getContactRow(organiser.id, other.id))?.status !== "accepted") return { ok: false, error: `Not sent: ${DM_CLOSED.removed}` };
  const conv = (await findConversation("dm", [task.owner_id, other.owner_id])) ?? (await createConversation({ kind: "dm", createdBy: task.owner_id, memberIds: [other.owner_id] }));
  const { state } = await dmState(conv.id, task.owner_id, organiser.id);
  if (state !== "open") return { ok: false, error: `Not sent: ${DM_CLOSED[state]}` };
  return { ok: true, id: conv.id };
}
