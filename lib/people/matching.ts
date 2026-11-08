import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import type { AgentRow } from "@/lib/data/agents";
import { hit, describeRetry } from "@/lib/limits";
import { codeHash, identifierHash, newCode, sameHash } from "./crypto";
import { maskEmail, maskPhone, normaliseEmail, normalisePhone, toIdentifier, MAX_ENTRIES, type Identifier } from "./normalise";
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

// ------------------------------------------------------------- address book

/**
 * Compares an address book with verified identifiers and keeps only matches to
 * people on AGENTME. The address book itself is never stored. Deliberately
 * returns no count of matches: a one-sided "is this number on AGENTME?" answer
 * would let anyone probe who uses the app. Only mutual suggestions are shown.
 */
export type ContactSource = "google" | "microsoft" | "phone" | "typed";

export async function syncAddressBook(
  agent: AgentRow,
  entries: string[],
  defaultCode: string | null,
  source: ContactSource = "typed",
): Promise<Result<{ checked: number }>> {
  const limit = await hit("contactSyncsPerAgent", agent.id);
  if (!limit.allowed) return { ok: false, error: `You've synced a lot today. Try again in ${describeRetry(limit.retryAfterSeconds)}.` };
  const hashes = [
    ...new Set(
      entries
        .slice(0, MAX_ENTRIES)
        .map((e) => (typeof e === "string" ? toIdentifier(e.slice(0, 200), defaultCode) : null))
        .filter((id): id is Identifier => id !== null)
        .map(identifierHash),
    ),
  ];

  const db = adminClient();
  const matched = new Set<string>();
  for (let i = 0; i < hashes.length; i += 300) {
    const { data } = await db.from("agent_identifiers").select("agent_id").in("hash", hashes.slice(i, i + 300));
    for (const row of data ?? []) if (row.agent_id !== agent.id) matched.add(row.agent_id);
  }
  // Sources add up (Gmail + phone + typed); "Forget" clears them all.
  if (matched.size) {
    await db
      .from("address_book_matches")
      .upsert([...matched].map((matched_agent) => ({ owner_agent: agent.id, matched_agent })), { onConflict: "owner_agent,matched_agent", ignoreDuplicates: true });
  }
  const now = new Date().toISOString();
  const { data: current } = await db.from("agents").select("contact_sources").eq("id", agent.id).single();
  const sources = { ...((current?.contact_sources as Record<string, string> | null) ?? {}), [source]: now };
  await db.from("agents").update({ contacts_synced_at: now, contact_sources: sources }).eq("id", agent.id);
  return { ok: true, checked: hashes.length };
}

/** Forget everything from the address book. */
export async function clearAddressBook(agentId: string) {
  const db = adminClient();
  await db.from("address_book_matches").delete().eq("owner_agent", agentId);
  await db.from("agents").update({ contacts_synced_at: null, contact_sources: {} }).eq("id", agentId);
}

export type Suggestion = { id: string; handle: string; display_name: string; avatar: string };

/**
 * People you know: you have them AND they have you, and you aren't connected
 * yet (no contact row of any kind, so a block is never revealed or bypassed).
 */
export async function mutualSuggestions(agentId: string): Promise<Suggestion[]> {
  const db = adminClient();
  const { data: mine } = await db.from("address_book_matches").select("matched_agent").eq("owner_agent", agentId);
  const candidates = (mine ?? []).map((m) => m.matched_agent);
  if (!candidates.length) return [];
  const { data: theirs } = await db.from("address_book_matches").select("owner_agent").eq("matched_agent", agentId).in("owner_agent", candidates);
  const mutual = (theirs ?? []).map((t) => t.owner_agent);
  if (!mutual.length) return [];
  const { data: rows } = await db
    .from("contacts")
    .select("requester_agent, addressee_agent")
    .or(`requester_agent.eq.${agentId},addressee_agent.eq.${agentId}`);
  const connected = new Set((rows ?? []).flatMap((r) => [r.requester_agent, r.addressee_agent]));
  const { data: agents } = await db
    .from("agents")
    .select("id, handle, display_name, avatar")
    .in("id", mutual.filter((id) => !connected.has(id)))
    .eq("guest", false);
  return agents ?? [];
}
