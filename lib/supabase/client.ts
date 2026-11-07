"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";

let browser: ReturnType<typeof createBrowserClient<Database>> | undefined;

/** Browser client (RLS applies). Used for Realtime subscriptions only. */
export function browserClient() {
  browser ??= createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return browser;
}
