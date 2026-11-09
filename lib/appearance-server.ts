import "server-only";
import { cookies } from "next/headers";
import { adminClient } from "@/lib/supabase/admin";
import { APPEARANCE_COOKIE, parseAppearance, serializeAppearance, type Appearance } from "@/lib/appearance";

const YEAR = 60 * 60 * 24 * 365;

/** This device's appearance (defaults when never set). */
export async function currentAppearance(): Promise<Appearance> {
  return parseAppearance((await cookies()).get(APPEARANCE_COOKIE)?.value);
}

export async function rememberOnDevice(a: Appearance) {
  (await cookies()).set(APPEARANCE_COOKIE, serializeAppearance(a), { path: "/", maxAge: YEAR, sameSite: "lax", httpOnly: false });
}

/** Saved on the person's own agent (their personal one when they have it), so it follows them to every device and identity. */
async function personAgentId(personId: string): Promise<string | null> {
  const { data } = await adminClient().from("agents").select("id, type").eq("owner_id", personId);
  const rows = data ?? [];
  return (rows.find((r) => r.type === "personal") ?? rows[0])?.id ?? null;
}

export async function saveForPerson(personId: string, a: Appearance) {
  const id = await personAgentId(personId);
  if (id) await adminClient().from("agents").update({ appearance: a }).eq("id", id);
}

/** At login: bring the person's saved look to this device (keeps the device's look if they never chose one). */
export async function restoreAtLogin(personId: string) {
  const id = await personAgentId(personId);
  if (!id) return;
  const { data } = await adminClient().from("agents").select("appearance").eq("id", id).maybeSingle();
  const saved = data?.appearance;
  if (saved && typeof saved === "object" && Object.keys(saved).length) await rememberOnDevice(parseAppearance(saved));
}
