"use server";

import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Session-scoped dismissal; never accepts another identity's id. */
export async function dismissSetupAction(): Promise<{ error?: string }> {
  const user = await requireUser();
  const db = await createClient();
  const { error } = await db.from("onboarding_state").update({ dismissed_at: new Date().toISOString() }).eq("user_id", user.id).is("dismissed_at", null);
  return error ? { error: "Couldn't save that choice. Please try again." } : {};
}
