import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import type { AgentRow } from "@/lib/data/agents";
import { hit, describeRetry } from "@/lib/limits";
import { codeHash, identifierHash, newCode, sameHash } from "./crypto";
import { maskEmail, maskPhone, normaliseEmail, normalisePhone, type Identifier } from "./normalise";
import { sendSms } from "./sms";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Saves a verified identifier. An email/phone belongs to one account: the newest verified owner. */
async function saveIdentifier(agentId: string, id: Identifier) {
  const db = adminClient();
  const hash = identifierHash(id);
  await db.from("agent_identifiers").delete().eq("hash", hash).neq("agent_id", agentId);
  await db
    .from("agent_identifiers")
    .upsert(
      { agent_id: agentId, kind: id.kind, hash, hint: id.kind === "email" ? maskEmail(id.value) : maskPhone(id.value), verified_at: new Date().toISOString() },
      { onConflict: "agent_id,kind" },
    );
}

/** The account email counts only once Supabase Auth has confirmed it. */
export async function registerAccountEmail(agentId: string, user: { email: string | null; emailConfirmed: boolean }) {
  const email = user.email && user.emailConfirmed ? normaliseEmail(user.email) : null;
  if (email) await saveIdentifier(agentId, { kind: "email", value: email });
}

// ------------------------------------------------------------- phone verification

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

/** Texts a 6-digit code. In dev mode the code is returned to show on screen (no SMS is sent). */
export async function startPhoneVerification(agent: AgentRow, raw: string): Promise<Result<{ devCode?: string }>> {
  const phone = normalisePhone(raw);
  if (!phone) return { ok: false, error: "Enter your number with its country code, e.g. +44 7700 900123." };
  const limit = await hit("phoneCodesPerAgent", agent.id);
  if (!limit.allowed) return { ok: false, error: `Too many codes. Try again in ${describeRetry(limit.retryAfterSeconds)}.` };
  const code = newCode();
  const sms = await sendSms(phone, `Your AGENTME code is ${code}. It expires in 10 minutes.`);
  if (!sms.sent) return { ok: false, error: "Phone verification isn't available yet." };
  await adminClient()
    .from("phone_verifications")
    .upsert({
      agent_id: agent.id,
      phone_hash: identifierHash({ kind: "phone", value: phone }),
      hint: maskPhone(phone),
      code_hash: codeHash(agent.id, code),
      attempts: 0,
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    });
  return sms.dev ? { ok: true, devCode: code } : { ok: true };
}

export async function confirmPhone(agent: AgentRow, raw: string, code: string): Promise<Result> {
  const phone = normalisePhone(raw);
  const db = adminClient();
  const { data: pending } = await db.from("phone_verifications").select("*").eq("agent_id", agent.id).maybeSingle();
  if (!phone || !pending || pending.phone_hash !== identifierHash({ kind: "phone", value: phone })) {
    return { ok: false, error: "Send a code to this number first." };
  }
  if (new Date(pending.expires_at).getTime() < Date.now() || pending.attempts >= MAX_ATTEMPTS) {
    await db.from("phone_verifications").delete().eq("agent_id", agent.id);
    return { ok: false, error: "That code has expired. Send a new one." };
  }
  if (!sameHash(pending.code_hash, codeHash(agent.id, code.trim()))) {
    await db.from("phone_verifications").update({ attempts: pending.attempts + 1 }).eq("agent_id", agent.id);
    return { ok: false, error: "That code isn't right." };
  }
  await db.from("phone_verifications").delete().eq("agent_id", agent.id);
  await saveIdentifier(agent.id, { kind: "phone", value: phone });
  return { ok: true };
}

export async function removePhone(agentId: string) {
  await adminClient().from("agent_identifiers").delete().eq("agent_id", agentId).eq("kind", "phone");
}
