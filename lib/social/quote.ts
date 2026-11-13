/**
 * ↩ Reply: quoting an earlier message in the same chat. Pure (no server
 * code), unit-tested.
 *  - Only messages everyone in the chat can see (never a private @agent
 *    answer), not removed, not app notes.
 *  - The quote points to the original: if it's removed, the quote says so.
 *  - Agents get the quoted text as context, marked as data.
 */

export type Quotable = {
  sender_user_id: string | null;
  sender_agent_id: string | null;
  removed_at?: string | null;
  visible_to?: string | null;
  metadata?: unknown;
  content: string;
};

/** Messages that are private, removed, app notes or your own private @agent command can't be quoted. */
export function canQuote(m: Quotable): boolean {
  if (!m.sender_user_id && !m.sender_agent_id) return false;
  if (m.removed_at || m.visible_to) return false;
  if (((m.metadata ?? {}) as { kind?: string }).kind === "agent_command") return false;
  return Boolean(m.content.trim());
}

/** Two short lines of the original for the quote (whitespace collapsed). */
export function quoteSnippet(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** What an agent is told about the quoted message (the caller wraps it as untrusted data). */
export function quoteContext(author: string, text: string): string {
  return `${author}: ${text.trim().slice(0, 1500)}`;
}

/** A question sent to an agent, with what it replies to ("and on Sundays?" → which earlier answer). */
export function withReplyContext(text: string, replyContext?: string): string {
  return replyContext ? `${text}\n\n(Replying to — ${replyContext.slice(0, 600)})` : text;
}

/** What the owner's reply is about, for the client: the target of "↩ Reply". */
export type ReplyTarget = { id: string; author: string; snippet: string };
