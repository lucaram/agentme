import type { MentionAlert } from "./mentions";

export type MentionBatch = { items: MentionAlert[]; generation: number };
export const EMPTY_MENTION_BATCH: MentionBatch = { items: [], generation: 0 };
export const MENTION_BANNER_MS = 10000;

/** Keep arrivals across fetches; only genuinely new message IDs reset the timer. */
export function mergeMentionBatch(batch: MentionBatch, incoming: MentionAlert[], activeChat?: string, checked: string[] = [], unread: string[] = checked): MentionBatch {
  const checkedIds = new Set(checked); const unreadIds = new Set(unread);
  const kept = batch.items.filter((item) => item.conversation_id !== activeChat && (!checkedIds.has(item.message_id) || unreadIds.has(item.message_id)));
  const ids = new Set(kept.map((item) => item.message_id)); let added = false;
  for (const item of incoming) if (item.conversation_id !== activeChat && !ids.has(item.message_id)) { kept.push(item); ids.add(item.message_id); added = true; }
  if (!added && kept.length === batch.items.length) return batch;
  return { items: kept, generation: batch.generation + (added ? 1 : 0) };
}

export function mentionBatchLabel(items: MentionAlert[]) {
  if (!items.length) return "";
  if (items.length === 1) return `${items[0].sender} mentioned you in ${items[0].chat_name}.`;
  const chats = new Set(items.map((item) => item.conversation_id));
  return chats.size === 1 ? `${items.length} new mentions in ${items[0].chat_name}` : `${items.length} new mentions in ${chats.size} chats`;
}
