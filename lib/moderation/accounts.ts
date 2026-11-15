import "server-only";
import { z } from "zod";
import { adminClient } from "@/lib/supabase/admin";

export const Restriction = z.object({ id: z.uuid().nullable(), user_key: z.uuid(), name: z.string(), action: z.enum(["suspend_1m", "suspend_3m", "ban", "owner_restricted"]), justification: z.string(), created_at: z.string().nullable(), expires_at: z.string().nullable() });
export type Restriction = z.infer<typeof Restriction>;
export async function accountRestriction(userId: string): Promise<Restriction | null> {
  const { data, error } = await adminClient().rpc("account_restriction", { p_user: userId });
  if (error) throw new Error("Couldn't verify account access. Please try again.");
  return data === null ? null : Restriction.parse(data);
}
export async function accountRestricted(userId: string) {
  const { data, error } = await adminClient().rpc("account_is_restricted", { p_user: userId });
  if (error) throw new Error("Couldn't verify account access. Please try again.");
  return Boolean(data);
}
