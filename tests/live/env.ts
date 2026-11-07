/**
 * Shared setup for "live" suites that need the local Supabase stack and/or a
 * running AGENTME server. They skip automatically when those aren't available.
 *
 * LIVE_TEST_URL must point at a server started with LLM_PROVIDER=mock (CI does
 * this). It is deliberately NOT read from APP_URL, so `npm test` never sends
 * traffic to a dev server that is using the real (paid) model.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local", quiet: true });

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const SECRET = process.env.A2A_SIGNING_SECRET ?? "";
export const LIVE_URL = process.env.LIVE_TEST_URL ?? "";

export const dbUp = SUPABASE_URL
  ? await fetch(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: ANON_KEY } }).then((r) => r.ok).catch(() => false)
  : false;

export const serverUp =
  dbUp && LIVE_URL
    ? await fetch(`${LIVE_URL}/api/a2a/marco/.well-known/agent-card.json`).then((r) => r.ok).catch(() => false)
    : false;

export function admin() {
  return createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", { auth: { persistSession: false } });
}

export async function agentIds(): Promise<Record<string, { id: string; owner_id: string }>> {
  const { data } = await admin().from("agents").select("id, handle, owner_id");
  return Object.fromEntries((data ?? []).map((a) => [a.handle, { id: a.id, owner_id: a.owner_id }]));
}
