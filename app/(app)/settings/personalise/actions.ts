"use server";

import { requireAgent } from "@/lib/auth";
import { parseAppearance } from "@/lib/appearance";
import { rememberOnDevice } from "@/lib/appearance-server";
import { createClient } from "@/lib/supabase/server";

/** The database binds both the actual person and selected identity, including Staff. */
export async function saveAppearanceAction(input: unknown): Promise<{ error?: string }> {
  await requireAgent();
  const look = parseAppearance(input);
  const { error } = await (await createClient()).rpc("set_identity_appearance", { p_appearance: look });
  if (error) return { error: "Couldn't save your appearance. Please try again." };
  await rememberOnDevice(look);
  return {};
}
