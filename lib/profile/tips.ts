import "server-only";
import { z } from "zod";
import { adminClient } from "@/lib/supabase/admin";

const Input = z.object({ id: z.uuid().optional(), topic: z.string().trim().min(2, "Add a topic and your tip.").max(80), tip: z.string().trim().min(1, "Add a topic and your tip.").max(500), share: z.boolean() });
type Owner = { agentId: string; userId: string };

/** Scope writes to the verified account, even though they use the service client. */
export async function saveTip(owner: Owner, raw: unknown): Promise<{ error?: string }> {
  const parsed = Input.safeParse(raw); if (!parsed.success) return { error: parsed.error.issues[0].message };
  const db = adminClient(); const { data: agent } = await db.from("agents").select("id").eq("id", owner.agentId).eq("owner_id", owner.userId).eq("type", "personal").maybeSingle();
  if (!agent) return { error: "Not found." };
  const { id, topic, tip, share } = parsed.data; const value = { topic, tip, disclosure: share ? "contacts" as const : "private" as const };
  if (id) {
    const result = await db.from("agent_tips").update(value).eq("id", id).eq("agent_id", agent.id).select("id").maybeSingle();
    return result.error || !result.data ? { error: "Couldn't save this tip." } : {};
  }
  const { count, error } = await db.from("agent_tips").select("id", { count: "exact", head: true }).eq("agent_id", agent.id);
  if (error) return { error: "Couldn't save this tip." };
  if ((count ?? 0) >= 100) return { error: "You can keep up to 100 tips." };
  const result = await db.from("agent_tips").insert({ agent_id: agent.id, ...value });
  return result.error ? { error: "Couldn't save this tip." } : {};
}

/** Private tips are available only in their owner's private agent context. */
export async function ownerTips(owner: Owner) {
  const { data, error } = await adminClient().from("agent_tips").select("topic, tip, disclosure, agents!inner(owner_id)").eq("agent_id", owner.agentId).eq("agents.owner_id", owner.userId).order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []).map(({ topic, tip, disclosure }) => ({ topic, tip, disclosure }));
}
