import "server-only";
import { createClient } from "@/lib/supabase/server";
import { Attention } from "./types";

export async function moderationAttention() {
  const db = await createClient(); const [{ data }, { data: appeals }] = await Promise.all([db.rpc("platform_attention"), db.rpc("open_account_appeal_count")]);
  return Attention.safeParse(data ? { ...data as object, appeals: Number(appeals ?? 0) } : null).data ?? { platform: 0, appeals: 0, local: [], notifications: [] };
}
export async function platformModerator() { return Boolean((await (await createClient()).rpc("is_platform_moderator")).data); }
export async function platformOperator() { return Boolean((await (await createClient()).rpc("is_platform_operator")).data); }
