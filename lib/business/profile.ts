import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { asJson } from "@/lib/data/json";

/** Caller authorizes ownership. Only the named fields are changed atomically. */
export async function patchBusinessInfo(agentId: string, patch: Record<string, unknown>, bio?: string) {
  const { error } = await adminClient().rpc("patch_business_info", { p_agent: agentId, p_patch: asJson(patch), ...(bio === undefined ? {} : { p_bio: bio }) });
  if (error) throw new Error("Couldn't save your business information. Please try again.");
}
