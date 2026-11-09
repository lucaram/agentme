import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { getAgentForUser, getContactRow } from "@/lib/data/agents";

/**
 * Whether a direct message chat is still open. Direct messages are for
 * contacts: once one of you removes the other, the chat stays readable but
 * closed; a block closes it too, without saying so to the blocked person.
 * Becoming contacts again reopens the same chat with its history.
 */
export type DmState = "open" | "left" | "removed" | "blocked";

export async function dmState(conversationId: string, userId: string, myAgentId: string): Promise<{ state: DmState; otherHandle: string | null }> {
  const { data: members } = await adminClient().from("conversation_members").select("user_id").eq("conversation_id", conversationId).neq("user_id", userId);
  const otherUser = members?.[0]?.user_id;
  if (!otherUser) return { state: "left", otherHandle: null };
  const other = await getAgentForUser(otherUser);
  if (!other) return { state: "left", otherHandle: null };
  const row = await getContactRow(myAgentId, other.id);
  const state: DmState = row?.status === "accepted" ? "open" : row?.status === "blocked" ? "blocked" : "removed";
  return { state, otherHandle: other.handle };
}

/** What the sender is told (a block isn't revealed as a block). */
export const DM_CLOSED: Record<Exclude<DmState, "open">, string> = {
  left: "The other person left this chat. Message them again from Contacts.",
  removed: "You're no longer contacts. Send a contact request to message again.",
  blocked: "You can't message this person.",
};
