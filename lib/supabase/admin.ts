import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { env } from "@/lib/env";

let admin: ReturnType<typeof createClient<Database>> | undefined;

/**
 * Service-role client. Bypasses RLS, so callers MUST authorise the acting
 * user/agent in code before reading or writing on their behalf.
 */
export function adminClient() {
  admin ??= createClient<Database>(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

export type AdminClient = ReturnType<typeof adminClient>;
