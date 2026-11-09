import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { canQuote } from "./quote";

/** The message being replied to, checked: same chat, visible to everyone there, not removed. */
export type ReplyInfo = { id: string; author: string; text: string; fromAgentHandle: string | null };

export async function resolveReply(conversationId: string, replyTo: string | null | undefined): Promise<ReplyInfo | null> {
  if (!replyTo || !/^[0-9a-f-]{36}$/.test(replyTo)) return null;
  const db = adminClient();
  const { data: m } = await db
    .from("messages")
    .select("id, conversation_id, content, sender_user_id, sender_agent_id, removed_at, visible_to, metadata")
    .eq("id", replyTo)
    .maybeSingle();
  if (!m || m.conversation_id !== conversationId || !canQuote(m)) return null;
  if (m.sender_agent_id) {
    const { data: a } = await db.from("agents").select("handle").eq("id", m.sender_agent_id).maybeSingle();
    return { id: m.id, author: `@${a?.handle ?? "an"}'s agent`, text: m.content, fromAgentHandle: a?.handle ?? null };
  }
  const { data: person } = await db.from("agents").select("display_name").eq("owner_id", m.sender_user_id!).eq("type", "personal").limit(1).maybeSingle();
  return { id: m.id, author: person?.display_name ?? "Someone", text: m.content, fromAgentHandle: null };
}
