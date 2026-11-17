import { z } from "zod";

export const MentionOption = z.object({ id: z.uuid(), owner_id: z.uuid(), handle: z.string(), name: z.string(), avatar: z.string(), type: z.enum(["personal", "business"]), can_ask: z.boolean() });
export type MentionOption = z.infer<typeof MentionOption>;
export const Mention = z.object({ message_id: z.uuid(), conversation_id: z.uuid(), user_id: z.uuid(), agent_id: z.uuid(), handle: z.string() });
export type Mention = z.infer<typeof Mention>;
export const MentionAlert = z.object({ message_id: z.uuid(), conversation_id: z.uuid(), created_at: z.string(), sender: z.string(), avatar: z.string(), chat_name: z.string() });
export type MentionAlert = z.infer<typeof MentionAlert>;
export const MentionState = z.object({ chats: z.array(z.object({ conversation_id: z.uuid(), total: z.number(), first_message: z.uuid() })), alerts: z.array(MentionAlert), total: z.number().optional(), active_ids: z.array(z.uuid()).optional(), more_alerts: z.boolean().optional() });
export type MentionState = z.infer<typeof MentionState>;
export const MENTION_EVENT = "agentme:mentions";
export const OPEN_MENTIONS = "agentme:open-mentions";
export const MentionPage = z.object({ items: z.array(MentionAlert.extend({ preview: z.string() })), hasMore: z.boolean() });
export type MentionPage = z.infer<typeof MentionPage>;

/** Only the token touching the caret opens the picker; emails and code do not. */
export function mentionAt(text: string, caret: number) {
  const before = text.slice(0, caret); const match = before.match(/(?:^|[^\w@])@([a-z0-9_]{0,20})$/i);
  if (!match || (before.match(/`/g)?.length ?? 0) % 2) return null;
  const start = caret - match[1].length - 1;
  if (/(?:^|\n)\s*>[^\n]*$/.test(before)) return null;
  return { start, end: caret, query: match[1] };
}
/** Explicit asking is an action; merely naming someone never contacts them. */
export function personAgentAsk(text: string) {
  const match = text.trim().match(/^(?:please\s+)?ask\s+@([a-z0-9_]{3,20})(?![a-z0-9_])(?:['’]s\s+agent)?\s*[:,]?\s+([\s\S]+)$/i);
  if (!match) return null;
  let question = match[2].trim();
  if (/^(?:(?:and|&)\s*)?@[a-z0-9_]{3,20}\b/i.test(question)) return null; // Existing multi-person plans keep their composer.
  question = question.replace(/^(?:whether|if)\s+(?:he|she|they)(?:['’]s|\s+is|\s+are)\s+/i, "Are you ")
    .replace(/^(?:whether|if)\s+(?:he|she|they)\s+can\s+/i, "Can you ");
  question = question[0].toUpperCase() + question.slice(1);
  if (!/[?!]$/.test(question)) question = question.replace(/\.+$/, "") + "?";
  return { handle: match[1].toLowerCase(), question: question.slice(0, 500) };
}
