import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/database.types";
import type { Relationship } from "@/lib/policy/contactPolicy";
import type { Fact } from "@/lib/policy/disclosure";

export type AgentRow = Database["public"]["Tables"]["agents"]["Row"];
export type ContactRow = Database["public"]["Tables"]["contacts"]["Row"];

export async function getAgentByHandle(handle: string): Promise<AgentRow | null> {
  const { data } = await adminClient().from("agents").select("*").eq("handle", handle.toLowerCase()).maybeSingle();
  return data;
}

export async function getAgentById(id: string): Promise<AgentRow | null> {
  const { data } = await adminClient().from("agents").select("*").eq("id", id).maybeSingle();
  return data;
}

export async function getAgentForUser(userId: string): Promise<AgentRow | null> {
  const { data } = await adminClient().from("agents").select("*").eq("owner_id", userId).maybeSingle();
  return data;
}

/** What the agent knows about its owner (entries that have expired, e.g. "away until…", are left out). */
export async function getFacts(agentId: string): Promise<Fact[]> {
  const { data, error } = await adminClient()
    .from("agent_facts")
    .select("category, value, disclosure, label")
    .eq("agent_id", agentId)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  if (error) throw error;
  return (data ?? []) as Fact[];
}

/** Only explicitly shareable tips ever enter another agent's reply context. */
export async function getTips(agentId: string) {
  const { data, error } = await adminClient().from("agent_tips").select("topic, tip, disclosure").eq("agent_id", agentId).eq("disclosure", "contacts").limit(200);
  if (error) throw error;
  return data ?? [];
}

export async function getContactRow(a: string, b: string): Promise<ContactRow | null> {
  const { data } = await adminClient()
    .from("contacts")
    .select("*")
    .or(`and(requester_agent.eq.${a},addressee_agent.eq.${b}),and(requester_agent.eq.${b},addressee_agent.eq.${a})`)
    .maybeSingle();
  return data;
}

export async function getRelationship(a: string, b: string): Promise<Relationship> {
  const row = await getContactRow(a, b);
  return row ? row.status : "none";
}
