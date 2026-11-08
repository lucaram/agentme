import "server-only";
import { getOrCreateMyAgentConversation, postMessage } from "@/lib/data/chat";

/**
 * Your agent tells you something in My Agent: a new request waiting for your
 * answer (it also counts as unread, so the Chats badge shows it), or a
 * confirmation of what you decided.
 */
export async function tellOwner(ownerUserId: string, ownAgentId: string, content: string) {
  const conv = await getOrCreateMyAgentConversation(ownerUserId);
  await postMessage({ conversationId: conv.id, from: "agent", agentId: ownAgentId, content, metadata: { kind: "request_note" } });
}

export const NEEDS_ANSWER = "It's waiting for you in “Needs your answer” at the top of this chat.";
