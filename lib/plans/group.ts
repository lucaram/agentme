import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { getAgentByHandle, type AgentRow } from "@/lib/data/agents";
import { createConversation, findConversation, getConversation } from "@/lib/data/chat";
import type { TaskRow } from "./types";

/**
 * The group conversation a plan is shared in (organiser + participants).
 * Reuses the plan's group, or an existing group with exactly these members.
 */
export async function ensurePlanGroup(task: TaskRow, handles: string[], title: string) {
  if (task.group_conversation_id) {
    const existing = await getConversation(task.group_conversation_id);
    if (existing) return existing;
  }
  const agents = (await Promise.all(handles.map((h) => getAgentByHandle(h)))).filter((a): a is AgentRow => a !== null);
  const memberIds = agents.map((a) => a.owner_id).filter((id) => id !== task.owner_id);
  const found = await findConversation("group", [task.owner_id, ...memberIds]);
  const group = (found ? await getConversation(found.id) : null) ??
    (await createConversation({ kind: "group", title: title.slice(0, 80), createdBy: task.owner_id, memberIds }));
  await adminClient().from("tasks").update({ group_conversation_id: group.id }).eq("id", task.id);
  task.group_conversation_id = group.id;
  return group;
}
