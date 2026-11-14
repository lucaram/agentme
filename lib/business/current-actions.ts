import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { waysOf, type Way } from "./booking";
import { reservationWays } from "./reservations";
import type { Json } from "@/lib/database.types";

export type CurrentActions = { all: Way[]; reservation: Way[] };
const isId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/** Resolve old button snapshots to a business only through an unambiguous published action. */
export async function currentChatActions(ids: string[], legacy: { messageId: string; ways: Way[]; metadata?: Json }[] = []) {
  const db = adminClient();
  const identities = new Map<string, string>();
  const key = (way: Way) => JSON.stringify([way.kind, way.value]);
  // Legacy snapshots usually repeat the same handful of contacts. Bound discovery work.
  const distinct = [...new Map(legacy.flatMap((s) => s.ways.map((w) => [key(w), w] as const))).values()].slice(0, 40);
  const matches = new Map(await Promise.all(distinct.map(async (w) => {
    const { data, error } = await db.from("agents").select("id").eq("type", "business").contains("business_info", { ways: [{ kind: w.kind, value: w.value }] }).limit(2);
    return [key(w), !error ? (data ?? []).map((b) => b.id) : []] as const;
  })));
  for (const snapshot of legacy) {
    const candidates = new Set(snapshot.ways.flatMap((w) => {
      const found = matches.get(key(w)) ?? [];
      return found.length === 1 ? found : [];
    }));
    if (candidates.size === 1) identities.set(snapshot.messageId, [...candidates][0]);
  }
  // Called with messages already authorised by chat RLS. Remember only the resolved
  // identity, so changing/removing every old destination cannot break the live link.
  // The message text and historical button snapshot are left intact.
  await Promise.all(legacy.filter((s) => identities.has(s.messageId) && s.metadata && typeof s.metadata === "object" && !Array.isArray(s.metadata)).map(async (s) => {
    await db.from("messages").update({ metadata: { ...(s.metadata as Record<string, Json>), booking_business_id: identities.get(s.messageId)! } }).eq("id", s.messageId).is("metadata->>booking_business_id", null);
  }));
  const businessIds = [...new Set([...ids, ...identities.values()].filter(isId))];
  const actions = new Map<string, CurrentActions>();
  if (businessIds.length) {
    const [{ data: businesses, error }, { data: sites, error: siteError }] = await Promise.all([
      db.from("agents").select("id,business_info").eq("type", "business").in("id", businessIds),
      db.from("business_sites").select("agent_id,url,live_at,learned,hidden").in("agent_id", businessIds).not("live_at", "is", null),
    ]);
    if (!error) for (const business of businesses ?? []) {
      const info = (business.business_info ?? {}) as { ways?: unknown };
      const reservation = siteError && !Array.isArray(info.ways) ? [] : reservationWays(info, sites?.find((s) => s.agent_id === business.id));
      actions.set(business.id, { all: Array.isArray(info.ways) ? waysOf(info) : reservation, reservation });
    }
  }
  // Never use the historical destination as a fallback for an unknown or deleted business.
  return { actions, legacyIdentities: identities, businessIds };
}
