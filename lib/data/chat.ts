import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/database.types";
import { asJson } from "./json";

export type ConversationKind = Database["public"]["Enums"]["conversation_kind"];
export type MessageRow = Database["public"]["Tables"]["messages"]["Row"];

export async function isMember(conversationId: string, userId: string): Promise<boolean> {
  const { data } = await adminClient()
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

export async function getConversation(id: string) {
  const { data } = await adminClient().from("conversations").select("*").eq("id", id).maybeSingle();
  return data;
}

export async function createConversation(opts: {
  kind: ConversationKind;
  title?: string | null;
  createdBy: string;
  memberIds: string[];
  targetAgent?: string | null;
}) {
  const db = adminClient();
  const { data: conv, error } = await db
    .from("conversations")
    .insert({ kind: opts.kind, title: opts.title ?? null, created_by: opts.createdBy, target_agent: opts.targetAgent ?? null })
    .select("*")
    .single();
  if (error) throw error;
  const members = [...new Set([opts.createdBy, ...opts.memberIds])].map((user_id) => ({ conversation_id: conv.id, user_id }));
  const { error: memberError } = await db.from("conversation_members").insert(members);
  if (memberError) throw memberError;
  return conv;
}

/** The user's private conversation with their own agent (created on demand). */
export async function getOrCreateMyAgentConversation(userId: string) {
  const db = adminClient();
  const { data: memberships } = await db.from("conversation_members").select("conversation_id").eq("user_id", userId);
  const ids = (memberships ?? []).map((m) => m.conversation_id);
  if (ids.length) {
    const { data } = await db.from("conversations").select("*").in("id", ids).eq("kind", "my_agent").limit(1).maybeSingle();
    if (data) return data;
  }
  return createConversation({ kind: "my_agent", title: "My Agent", createdBy: userId, memberIds: [] });
}

/** Find an existing conversation of `kind` whose members are exactly `userIds` (and optional target). */
export async function findConversation(kind: ConversationKind, userIds: string[], targetAgent?: string) {
  const db = adminClient();
  const { data: memberships } = await db.from("conversation_members").select("conversation_id").eq("user_id", userIds[0]);
  const ids = (memberships ?? []).map((m) => m.conversation_id);
  if (!ids.length) return null;
  let query = db.from("conversations").select("id, conversation_members(user_id)").in("id", ids).eq("kind", kind);
  if (targetAgent) query = query.eq("target_agent", targetAgent);
  const { data } = await query;
  const want = [...new Set(userIds)].sort().join(",");
  return (
    (data ?? []).find((c) => c.conversation_members.map((m) => m.user_id).sort().join(",") === want) ?? null
  );
}

type NewMessage = {
  conversationId: string;
  content: string;
  metadata?: Record<string, unknown>;
} & (
  | { from: "human"; userId: string }
  | { from: "agent"; agentId: string }
  | { from: "system" }
);

export async function postMessage(msg: NewMessage): Promise<MessageRow> {
  const { data, error } = await adminClient()
    .from("messages")
    .insert({
      conversation_id: msg.conversationId,
      content: msg.content.slice(0, 8000),
      metadata: asJson(msg.metadata ?? {}),
      sender_user_id: msg.from === "human" ? msg.userId : null,
      sender_agent_id: msg.from === "agent" ? msg.agentId : null,
      // Trust rule: every agent-authored message is flagged as AI-generated.
      is_ai_generated: msg.from === "agent",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
