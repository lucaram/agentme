import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { getAgentByHandle, type AgentRow } from "@/lib/data/agents";
import { createConversation, getConversation } from "@/lib/data/chat";
import type { TaskRow } from "./types";

/**
 * The group conversation a plan is shared in (organiser + participants).
 * Each plan gets its OWN group, named after the plan, so its RSVPs, votes and
 * messages stay together and never mix with other plans between the same people.
 */
export async function ensurePlanGroup(task: TaskRow, handles: string[], title: string) {
  if (task.group_conversation_id) {
    // A plan started from a chat ("@agent ...") lives in that chat.
    const existing = await getConversation(task.group_conversation_id);
    if (existing) return { ...existing, created: false };
  }
  const agents = (await Promise.all(handles.map((h) => getAgentByHandle(h)))).filter((a): a is AgentRow => a !== null);
  const memberIds = agents.map((a) => a.owner_id).filter((id) => id !== task.owner_id);
  const group = await createConversation({ kind: "group", title: title.slice(0, 80), createdBy: task.owner_id, memberIds });
  // A plan’s own group is there for the plan: the organiser (its owner) lets people in with the plan’s invite
  // link, so it starts without the "admins approve new members" step. They can turn it on in the group’s
  // settings, and the plan’s link then respects it like any other way in.
  await adminClient().from("conversations").update({ approve_new_members: false }).eq("id", group.id);
  await adminClient().from("tasks").update({ group_conversation_id: group.id }).eq("id", task.id);
  task.group_conversation_id = group.id;
  return { ...group, created: true };
}

/** "a new group, “X”" vs "“X”" for the organiser's messages. */
export function whereShared(group: { title: string | null; created: boolean }, fallback: string) {
  const name = group.title ?? fallback;
  return group.created ? `a new group, “${name}”` : `“${name}”`;
}
