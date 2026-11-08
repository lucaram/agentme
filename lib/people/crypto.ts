import "server-only";
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import type { Identifier } from "./normalise";

/** A separate key per purpose, derived from the server secret. */
function key(purpose: string) {
  return createHmac("sha256", env.a2aSigningSecret).update(`agentme:${purpose}:v1`).digest();
}

const mac = (purpose: string, value: string) => createHmac("sha256", key(purpose)).update(value).digest("base64url");

/** Keyed hash of an email/phone: comparable, but not stored in readable form. */
export function identifierHash(id: Identifier): string {
  return mac("identifier", `${id.kind}:${id.value}`);
}

export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}
export function codeHash(agentId: string, code: string): string {
  return mac("phone-code", `${agentId}:${code}`);
}

export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Unguessable token for links (plan invites). */
export function randomToken(): string {
  return randomBytes(16).toString("base64url");
}

/** Live QR codes connect instantly for a short time; after that the link is a normal request. */
export const LIVE_CONNECT_SECONDS = 10 * 60;

export function liveConnectToken(agentId: string, nowMs = Date.now()): { token: string; expiresAt: Date } {
  const exp = Math.floor(nowMs / 1000) + LIVE_CONNECT_SECONDS;
  const sig = mac("live-connect", `${agentId}.${exp}`).slice(0, 22);
  return { token: `${exp.toString(36)}.${sig}`, expiresAt: new Date(exp * 1000) };
}

export function verifyLiveConnectToken(agentId: string, token: string, nowMs = Date.now()): boolean {
  const [expPart, sig] = token.split(".");
  const exp = parseInt(expPart ?? "", 36);
  if (!sig || !Number.isFinite(exp) || exp * 1000 < nowMs) return false;
  return sameHash(sig, mac("live-connect", `${agentId}.${exp}`).slice(0, 22));
}
