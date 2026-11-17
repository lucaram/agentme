import { z } from "zod";

export const PresenceMode = z.enum(["auto", "busy", "away", "invisible"]);
export type PresenceMode = z.infer<typeof PresenceMode>;
export const PresenceState = z.enum(["online", "busy", "away", "offline"]);
export type PresenceState = z.infer<typeof PresenceState>;
export const PresencePeer = z.object({ id: z.uuid(), business: z.boolean(), topic: z.string().regex(/^presence:[0-9a-f-]{36}:[0-9a-f-]{36}$/) });
export type PresencePeer = z.infer<typeof PresencePeer>;
export const PresenceOwn = PresencePeer.extend({ mode: PresenceMode, until: z.string().nullable(), visibility: z.enum(["contacts", "customers", "nobody"]), participating: z.boolean().optional(), staffTopic: z.string().regex(/^staff-presence:[0-9a-f-]{36}:[0-9a-f-]{36}:[0-9a-f-]{36}$/).optional() });
export type PresenceOwn = z.infer<typeof PresenceOwn>;
export const PresenceSnapshot = z.object({ own: PresenceOwn, peers: PresencePeer.array().max(100) });
export const IDLE_MS = 5 * 60_000;
export const OFFLINE_GRACE_MS = 5000;

/** Coarse availability only: no last-seen times, device ids or page locations. */
export function automaticState(mode: PresenceMode, visible: boolean, lastActivity: number, now: number): PresenceState {
  if (mode === "invisible") return "offline";
  if (mode === "busy") return "busy";
  if (mode === "away" || !visible || now - lastActivity >= IDLE_MS) return "away";
  return "online";
}
export function aggregatePresence(payloads: unknown[]): PresenceState {
  const states = payloads.flatMap((payload) => {
    const parsed = z.object({ state: z.enum(["online", "busy", "away"]) }).safeParse(payload);
    return parsed.success ? [parsed.data.state] : [];
  });
  return states.includes("online") ? "online" : states.includes("busy") ? "busy" : states.length ? "away" : "offline";
}
export const presenceLabel = (state: PresenceState, business: boolean) => `${business ? "Team " : ""}${business ? state : state[0].toUpperCase() + state.slice(1)}`;
