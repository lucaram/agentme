import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { getContactRow, type AgentRow } from "@/lib/data/agents";
import { describeRetry, hit } from "@/lib/limits";

/**
 * A contact request. If they already asked you, it's accepted (both want it).
 * Never reveals or overrides a block.
 */
export async function sendContactRequest(me: AgentRow, other: AgentRow): Promise<{ ok: true } | { error: string }> {
  if (other.id === me.id) return { error: "Agent not found." };
  const existing = await getContactRow(me.id, other.id);
  if (existing) {
    if (existing.status === "pending" && existing.addressee_agent === me.id) {
      await adminClient().from("contacts").update({ status: "accepted" }).eq("id", existing.id);
    }
    return { ok: true };
  }
  if (other.contact_policy === "nobody") return { error: `@${other.handle} isn't accepting contact requests.` };
  const limit = await hit("contactRequestsPerAgent", me.id);
  if (!limit.allowed) return { error: `Too many contact requests. Try again in ${describeRetry(limit.retryAfterSeconds)}.` };
  await adminClient().from("contacts").insert({ requester_agent: me.id, addressee_agent: other.id });
  return { ok: true };
}
