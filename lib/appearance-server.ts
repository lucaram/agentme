import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { APPEARANCE_COOKIE, DEFAULT_APPEARANCE, parseAppearance, serializeAppearance, type Appearance } from "@/lib/appearance";

const YEAR = 60 * 60 * 24 * 365;

/** Draw the selected identity in this person's colours on the first server render.
 * The device cookie is only a fallback for signed-out pages, never another identity.
 */
export const currentAppearance = cache(async (): Promise<Appearance> => {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return parseAppearance((await cookies()).get(APPEARANCE_COOKIE)?.value);
  const { data, error } = await client.rpc("current_identity_appearance");
  return error ? DEFAULT_APPEARANCE : parseAppearance(data);
});

export async function rememberOnDevice(a: Appearance) {
  (await cookies()).set(APPEARANCE_COOKIE, serializeAppearance(a), { path: "/", maxAge: YEAR, sameSite: "lax", httpOnly: false });
}

/** Called after login or switching sessions, using the newly selected workspace. */
export async function restoreIdentityAppearance() {
  const { data, error } = await (await createClient()).rpc("current_identity_appearance");
  await rememberOnDevice(error ? DEFAULT_APPEARANCE : parseAppearance(data));
}
