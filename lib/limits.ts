import "server-only";
import { adminClient } from "@/lib/supabase/admin";

/**
 * Rate limits (fixed windows, stored in Postgres so they hold across restarts
 * and multiple app instances). Tuned for an invite-only beta; adjust freely.
 */
export const LIMITS = {
  /** A2A requests one calling agent may make to one recipient agent. */
  a2aPerCaller: { windowSeconds: 60, max: 30 },
  /** A2A requests from anonymous/external callers, per trusted address (or all together when no address can be trusted). */
  a2aAnonymousPerIp: { windowSeconds: 60, max: 10 },
  /** All anonymous A2A requests to one agent, whatever address they come from (each may cost its owner an AI answer). */
  a2aAnonymousPerAgent: { windowSeconds: 3600, max: 300 },
  /** Messages a user sends to their own agent or to another agent (each costs AI). */
  agentMessagesPerUser: { windowSeconds: 60, max: 20 },
  /** Coordination tasks a user may start. */
  tasksPerUser: { windowSeconds: 3600, max: 20 },
  /** Contact requests an agent may send (anti-spam). */
  contactRequestsPerAgent: { windowSeconds: 3600, max: 30 },
  /** Address-book syncs (each compares up to 5,000 entries). */
  contactSyncsPerAgent: { windowSeconds: 86400, max: 20 },
  /** Phone verification codes sent. */
  phoneCodesPerAgent: { windowSeconds: 3600, max: 5 },
  /** "Re-read now" on a business link. */
  businessRereadsPerAgent: { windowSeconds: 3600, max: 20 },
  /** Questions a business agent hands to its team, per asking agent and business. */
  businessHandoffsPerCaller: { windowSeconds: 86400, max: 10 },
  /** Community slow mode: messages per minute, by trust level (lib/social/guard.ts). */
  communityPostsNew: { windowSeconds: 60, max: 3 },
  communityPostsMember: { windowSeconds: 60, max: 8 },
  communityPostsTrusted: { windowSeconds: 60, max: 15 },
  /** AI checks of one person's messages in one community (each post by a new or regular member may run one). */
  moderationChecksPerUser: { windowSeconds: 600, max: 40 },
  /** Questions to businesses by @mention in groups and communities. */
  businessMentionsPerUser: { windowSeconds: 3600, max: 20 },
  /** Businesses a person can add ("Add a business"). */
  businessesPerPerson: { windowSeconds: 86400, max: 10 },
  /** A business agent looking on its own website for a page it hasn't read (address index, then a site search). */
  siteLookupsPerAgent: { windowSeconds: 86400, max: 200 },
  /** Web research by your own agent (My Agent and inline "@agent"). */
  researchPerUser: { windowSeconds: 3600, max: 30 },
  /** ↪ Forward: each forward goes to up to 5 chats. */
  forwardsPerUser: { windowSeconds: 3600, max: 60 },
  /** "Fill in from my website" at sign-up (one homepage fetch each). */
  sitePreviewsPerUser: { windowSeconds: 3600, max: 30 },
  /** Reading a whole website (first read or "Re-read now"): up to 30 pages and one AI summary each. */
  siteReadsPerAgent: { windowSeconds: 3600, max: 6 },
  /** "Ask around" requests (each reaches up to 25 contacts). */
  askAroundPerUser: { windowSeconds: 86400, max: 10 },
  /** Introductions an agent may make. */
  introductionsPerAgent: { windowSeconds: 3600, max: 20 },
  /** Guest accounts created from plan invite links, per invite. */
  guestJoinsPerInvite: { windowSeconds: 3600, max: 20 },
} as const;

export type LimitName = keyof typeof LIMITS;
export type LimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * Counts one hit against `name` for `subject` and says whether it is allowed.
 * Fails open (allows) if the limiter itself is unavailable, so a database
 * hiccup never takes the product down; the error is logged.
 */
export async function hit(name: LimitName, subject: string): Promise<LimitResult> {
  const { windowSeconds, max } = LIMITS[name];
  const { data, error } = await adminClient().rpc("rate_limit_hit", {
    p_key: `${name}:${subject}`,
    p_window_seconds: windowSeconds,
    p_max: max,
  });
  if (error || !data?.[0]) {
    console.error("rate limiter unavailable", error?.message);
    return { allowed: true };
  }
  return data[0].allowed ? { allowed: true } : { allowed: false, retryAfterSeconds: data[0].retry_after_seconds };
}

export function describeRetry(seconds: number): string {
  return seconds < 90 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minutes`;
}

/** Deletes expired windows (called by the background sweeper). */
export async function pruneRateLimits() {
  const cutoff = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  await adminClient().from("rate_limits").delete().lt("window_start", cutoff);
}
