/**
 * Community spam guard: free, instant checks in code before a message is
 * posted in a community chat. Strict for new members (most trouble comes from
 * new accounts), relaxed for trusted ones, off for moderators. Nothing here
 * needs a moderator: messages are either posted or refused with a clear reason.
 * Pure (no server code), unit-tested.
 */

export type TrustLevel = "new" | "member" | "trusted" | "moderator";

/** New until a day in and a few messages posted; trusted after a week and 20 messages with nothing removed. */
export const TRUST = {
  newForHours: 24,
  newUntilMessages: 3,
  trustedAfterDays: 7,
  trustedAfterMessages: 20,
} as const;

export function trustLevel(opts: { role: string | null; joinedAt: string; messages: number; removedRecently: number; now: number }): TrustLevel {
  if (opts.role === "owner" || opts.role === "moderator") return "moderator";
  const hours = (opts.now - Date.parse(opts.joinedAt)) / 3_600_000;
  // A recently removed message puts you back on the stricter rules for a while.
  if (opts.removedRecently > 0 || hours < TRUST.newForHours || opts.messages < TRUST.newUntilMessages) return "new";
  if (hours >= TRUST.trustedAfterDays * 24 && opts.messages >= TRUST.trustedAfterMessages) return "trusted";
  return "member";
}

const MAX_LINKS: Record<TrustLevel, number> = { new: 0, member: 3, trusted: 5, moderator: Infinity };
const MAX_MENTIONS = 5;

const LINK = /\bhttps?:\/\/\S+|\bwww\.\S+|\b[a-z0-9-]+\.(?:com|net|org|io|co|uk|me|ly|gg|xyz|link|shop|app)\b(?:\/\S*)?/gi;
const MENTION = /(^|[^a-z0-9_@])@[a-z0-9_]{3,20}\b/gi;
/** Likely selling or promotion: flagged for moderators (and the coming AI check), not blocked. */
const SELLING = /[£$€]\s?\d|\bfor sale\b|\bselling\b|\bbuy now\b|\bdm me\b|\bpromo code\b|\bdiscount code\b|\bcrypto\b|\bbitcoin\b|\bforex\b|\binvest(?:ment)? opportunit|\bwhatsapp me\b|\bt\.me\//i;

export const countLinks = (text: string) => (text.match(LINK) ?? []).length;
export const countMentions = (text: string) => (text.match(MENTION) ?? []).length;

/** Same message, ignoring case, spacing and punctuation. */
export const sameMessage = (a: string, b: string) => {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return norm(a) === norm(b) && norm(a).length > 0;
};

export type GuardResult = { ok: true; flags: string[] } | { ok: false; error: string };

/** Checks one message. `recent`: the sender's own messages in this community in the last few minutes. */
export function checkCommunityMessage(text: string, level: TrustLevel, recent: string[]): GuardResult {
  if (level === "moderator") return { ok: true, flags: [] };
  const links = countLinks(text);
  if (links > MAX_LINKS[level]) {
    return {
      ok: false,
      error:
        level === "new"
          ? "New members can't post links yet. You can once you've been here a day and posted a few messages."
          : `That's a lot of links for one message (up to ${MAX_LINKS[level]}).`,
    };
  }
  if (countMentions(text) > MAX_MENTIONS) return { ok: false, error: `Please mention at most ${MAX_MENTIONS} people in one message.` };
  if (recent.some((r) => sameMessage(r, text))) return { ok: false, error: "You've just posted that. Repeating the same message counts as spam." };
  return { ok: true, flags: SELLING.test(text) ? ["selling"] : [] };
}
