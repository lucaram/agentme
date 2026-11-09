/**
 * ↪ Forward: passing on a message is always a person's action (agents talk to
 * agents; people talk to people). A forwarded message is labelled, says when an
 * AI agent wrote the original, and is limited like WhatsApp: up to 5 chats at
 * once, and once forwarded many times, 1 chat at a time. Pure, unit-tested.
 */

export const MAX_FORWARD_PLACES = 5;
/** From this many forwards on, a message is "forwarded many times". */
export const MANY_TIMES = 5;

/** Stored on a forwarded message (metadata.forwarded). */
export type Forwarded = { count: number; from_ai: string | null };

type Original = { content: string; is_ai_generated: boolean; removed_at?: string | null; metadata: unknown; senderHandle?: string | null };

/** Plan cards, suggestions and system notes are part of the app, not messages to pass on. */
const NOT_FORWARDABLE = new Set([
  "task_card",
  "proposal",
  "info",
  "error",
  "poll",
  "rsvp",
  "assign",
  "question",
  "agent_command",
  "fact_suggestion",
  "business_suggestion",
  "request_note",
  "system",
  "draft",
]);

const metaOf = (m: unknown) => (m ?? {}) as { kind?: string; forwarded?: Forwarded; handle?: string };

export function canForward(m: Original & { system?: boolean }): { ok: true } | { ok: false; error: string } {
  if (m.removed_at) return { ok: false, error: "This message was removed." };
  if (m.system) return { ok: false, error: "Notes from the app can't be forwarded." };
  const kind = metaOf(m.metadata).kind;
  if (kind && NOT_FORWARDABLE.has(kind)) return { ok: false, error: "Plans and app cards can't be forwarded: share them from their group instead." };
  if (!m.content.trim()) return { ok: false, error: "There's nothing to forward." };
  return { ok: true };
}

/**
 * What is forwarded: the message as it is, except your agent's "🏪 I asked
 * @everyeye:" heading (the recipient gets the business's answer itself).
 */
export function forwardText(m: Original): string {
  const meta = metaOf(m.metadata);
  if (meta.kind === "business_answer") {
    return m.content.replace(/^🏪 I asked @[a-z0-9_]+:\s*/i, "").replace(/^👤 The team at .+? answered:\s*/, "").trim();
  }
  return m.content.trim();
}

/** The label of the forwarded copy: one more forward, and which AI agent wrote the original (if any). */
export function nextForward(m: Original): Forwarded {
  const meta = metaOf(m.metadata);
  if (meta.forwarded) return { count: meta.forwarded.count + 1, from_ai: meta.forwarded.from_ai };
  // A business's answer relayed by your agent: written by the business's agent. Its team's answers are people's.
  if (meta.kind === "business_answer" && meta.handle) return { count: 1, from_ai: m.content.startsWith("👤") ? null : meta.handle };
  if (meta.kind === "team_answer") return { count: 1, from_ai: null };
  return { count: 1, from_ai: m.is_ai_generated ? m.senderHandle ?? null : null };
}

/** How many chats this message can go to at once. */
export function placesAllowed(m: Original): number {
  return (metaOf(m.metadata).forwarded?.count ?? 0) >= MANY_TIMES ? 1 : MAX_FORWARD_PLACES;
}

/** "↪ Forwarded · from @everyeye's agent", or "↪↪ Forwarded many times". */
export function forwardLabel(f: Forwarded): string {
  const head = f.count >= MANY_TIMES ? "↪↪ Forwarded many times" : "↪ Forwarded";
  return f.from_ai ? `${head} · from @${f.from_ai}'s agent` : head;
}
