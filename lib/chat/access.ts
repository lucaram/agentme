import "server-only";
import { getConversation, isMember } from "@/lib/data/chat";
import { canPost, type ConvRow } from "@/lib/social/shared";
import { dmState, DM_CLOSED } from "@/lib/people/dm";

export async function chatWriteAccess(conversationId: string, userId: string, agentId: string) {
  if (!(await isMember(conversationId, userId))) throw new Error("Not found.");
  const conv = await getConversation(conversationId);
  if (!conv) throw new Error("Not found.");
  if (conv.kind === "dm") {
    const { state } = await dmState(conversationId, userId, agentId);
    if (state !== "open") throw new Error(DM_CLOSED[state]);
  }
  const allowed = await canPost(conv as ConvRow, userId);
  if (!allowed.ok) throw new Error(allowed.error);
  return conv;
}
