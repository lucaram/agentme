import "server-only";
import { getOrCreateMyAgentConversation, postMessage } from "@/lib/data/chat";

/**
 * Your agent tells you something in My Agent: a new request waiting for your
 * answer, or a confirmation of what you decided. Link action records to their
 * inbox item so the pending request and its note count as a single alert.
 */
export async function tellOwner(ownerUserId: string, ownAgentId: string, content: string, inboxId?: string) {
  const conv = await getOrCreateMyAgentConversation(ownerUserId);
  await postMessage({ conversationId: conv.id, from: "agent", agentId: ownAgentId, content, metadata: { kind: "request_note", ...(inboxId ? { inbox_item_id: inboxId } : {}) } });
}

export const NEEDS_ANSWER = "It's waiting for you in “Needs your answer” at the top of this chat.";
