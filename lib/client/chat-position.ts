import { z } from "zod";
export const CHAT_SENT = "agentme:chat-sent";
export const CHAT_JUMP = "agentme:chat-jump";
const pending = new Set<string>();
export const chatScope = (conversationId: string, threadId?: string | null) => `${conversationId}:${threadId ?? ""}`;
export function notifyChatSent(conversationId: string, threadId?: string | null) {
  const scope = chatScope(conversationId, threadId && threadId !== "new" ? threadId : null);
  pending.add(scope); window.dispatchEvent(new CustomEvent(CHAT_SENT, { detail: { scope } }));
}
export function consumeChatSent(scope: string) { const value = pending.has(scope); pending.delete(scope); return value; }
const Position = z.object({ id: z.uuid(), offset: z.number().finite().min(-10000).max(10000), bottom: z.boolean() });
export type ChatPosition = z.infer<typeof Position>;
export function readChatPosition(key: string): ChatPosition | null {
  try { return Position.safeParse(JSON.parse(sessionStorage.getItem(`chat-position:${key}`) ?? "null")).data ?? null; } catch { return null; }
}
export function saveChatPosition(key: string, position: ChatPosition) { try { sessionStorage.setItem(`chat-position:${key}`, JSON.stringify(position)); } catch { /* Storage-disabled sessions still scroll normally. */ } }
