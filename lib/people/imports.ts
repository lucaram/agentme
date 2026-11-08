import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { asJson } from "@/lib/data/json";
import type { AgentRow } from "@/lib/data/agents";
import { describeRetry, hit } from "@/lib/limits";
import { identifierHash } from "./crypto";
import { toIdentifier, type Identifier } from "./normalise";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export type ContactSource = "google" | "microsoft" | "phone" | "typed";
/** One person from an address book: a name (if known) and their emails/phone numbers. */
export type RawContact = { name: string | null; addresses: string[] };
type Item = { name: string | null; address: string; agent_id: string | null };

const MAX_CONTACTS = 2000;
const MAX_ADDRESSES = 5;
const LIST_TTL_MS = 30 * 60 * 1000;

/**
 * Turns an address book into the list the person ticks from: who is on AGENTME
 * (and findable), and who could be invited. Kept for at most 30 minutes.
 */
export async function createContactList(agent: AgentRow, source: ContactSource, contacts: RawContact[], defaultCode: string | null): Promise<Result<{ total: number }>> {
  const limit = await hit("contactSyncsPerAgent", agent.id);
  if (!limit.allowed) return { ok: false, error: `You've checked a lot of contacts today. Try again in ${describeRetry(limit.retryAfterSeconds)}.` };

  // Clean up: valid addresses only, names trimmed, at most 2,000 people.
  const people = contacts
    .slice(0, MAX_CONTACTS * 2)
    .map((c) => {
      const ids = (Array.isArray(c.addresses) ? c.addresses : [])
        .slice(0, MAX_ADDRESSES)
        .map((a) => (typeof a === "string" ? { raw: a.trim().slice(0, 200), id: toIdentifier(a.slice(0, 200), defaultCode) } : null))
        .filter((x): x is { raw: string; id: Identifier } => Boolean(x?.id));
      const name = typeof c.name === "string" ? c.name.trim().slice(0, 80) || null : null;
      return { name, ids };
    })
    .filter((p) => p.ids.length > 0)
    .slice(0, MAX_CONTACTS);

  // Which of these addresses belong to someone findable on AGENTME?
  const byHash = new Map<string, number[]>();
  people.forEach((p, i) => p.ids.forEach(({ id }) => byHash.set(identifierHash(id), [...(byHash.get(identifierHash(id)) ?? []), i])));
  const hashes = [...byHash.keys()];
  const db = adminClient();
  const owners = new Map<string, string>(); // hash -> agent id
  for (let i = 0; i < hashes.length; i += 300) {
    const { data } = await db.from("agent_identifiers").select("hash, agent_id").in("hash", hashes.slice(i, i + 300));
    for (const row of data ?? []) owners.set(row.hash, row.agent_id);
  }
  const candidateIds = [...new Set(owners.values())].filter((id) => id !== agent.id);
  const { data: findable } = candidateIds.length
    ? await db.from("agents").select("id").in("id", candidateIds).eq("discoverable", true).eq("guest", false)
    : { data: [] };
  const allowed = new Set((findable ?? []).map((a) => a.id));

  const seen = new Set<string>();
  const items: Item[] = [];
  for (const p of people) {
    const ownersOf = p.ids.map(({ id }) => owners.get(identifierHash(id)));
    if (ownersOf.includes(agent.id)) continue; // yourself
    const match = ownersOf.find((id) => id && allowed.has(id)) ?? null;
    // Show an email when there is one (easier to recognise), else the number as written.
    const shown = (p.ids.find(({ id }) => id.kind === "email") ?? p.ids[0]).raw;
    const key = match ?? shown.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ name: p.name, address: shown, agent_id: match });
  }

  const now = new Date();
  await db.from("contact_imports").upsert({
    agent_id: agent.id,
    source,
    items: asJson(items),
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + LIST_TTL_MS).toISOString(),
  });
  const { data: current } = await db.from("agents").select("contact_sources").eq("id", agent.id).single();
  const sources = { ...((current?.contact_sources as Record<string, string> | null) ?? {}), [source]: now.toISOString() };
  await db.from("agents").update({ contacts_synced_at: now.toISOString(), contact_sources: sources }).eq("id", agent.id);
  return { ok: true, total: items.length };
}

export type ContactListView = {
  source: ContactSource;
  expiresAt: string;
  onAgentme: { agentId: string; handle: string; displayName: string; avatar: string; name: string | null; address: string; status: "none" | "pending" | "accepted" }[];
  others: { name: string | null; address: string }[];
};

/** The person's current list (null when there is none or it expired). */
export async function loadContactList(agentId: string): Promise<ContactListView | null> {
  const db = adminClient();
  const { data: list } = await db.from("contact_imports").select("*").eq("agent_id", agentId).maybeSingle();
  if (!list) return null;
  if (new Date(list.expires_at).getTime() < Date.now()) {
    await db.from("contact_imports").delete().eq("agent_id", agentId);
    return null;
  }
  const items = list.items as unknown as Item[];
  const ids = items.map((i) => i.agent_id).filter((id): id is string => Boolean(id));
  const [{ data: agents }, { data: rows }] = await Promise.all([
    ids.length ? db.from("agents").select("id, handle, display_name, avatar, discoverable").in("id", ids) : Promise.resolve({ data: [] }),
    db.from("contacts").select("requester_agent, addressee_agent, status").or(`requester_agent.eq.${agentId},addressee_agent.eq.${agentId}`),
  ]);
  const byId = new Map((agents ?? []).map((a) => [a.id, a]));
  const relation = new Map((rows ?? []).map((r) => [r.requester_agent === agentId ? r.addressee_agent : r.requester_agent, r.status]));

  const view: ContactListView = { source: list.source as ContactSource, expiresAt: list.expires_at, onAgentme: [], others: [] };
  for (const item of items) {
    const a = item.agent_id ? byId.get(item.agent_id) : undefined;
    const status = a ? relation.get(a.id) : undefined;
    // Someone who blocked (or was blocked) is simply shown as not on AGENTME.
    if (a && a.discoverable && status !== "blocked") {
      view.onAgentme.push({ agentId: a.id, handle: a.handle, displayName: a.display_name, avatar: a.avatar, name: item.name, address: item.address, status: status ?? "none" });
    } else {
      view.others.push({ name: item.name, address: item.address });
    }
  }
  const byName = (x: { name: string | null; address: string }, y: { name: string | null; address: string }) => (x.name ?? x.address).localeCompare(y.name ?? y.address);
  view.onAgentme.sort(byName);
  view.others.sort(byName);
  return view;
}

export async function discardContactList(agentId: string) {
  await adminClient().from("contact_imports").delete().eq("agent_id", agentId);
}

/** Deletes lists nobody finished (called by the background sweeper). */
export async function pruneContactLists() {
  await adminClient().from("contact_imports").delete().lt("expires_at", new Date().toISOString());
}

/** Agent ids from the person's own current list (so "Add" can't be used on anyone else). */
export async function listedAgentIds(agentId: string): Promise<Set<string>> {
  const list = await loadContactList(agentId);
  return new Set((list?.onAgentme ?? []).map((p) => p.agentId));
}
