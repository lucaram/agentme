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

export async function getFacts(agentId: string): Promise<Fact[]> {
  const { data, error } = await adminClient()
    .from("agent_facts")
    .select("category, value, disclosure")
    .eq("agent_id", agentId);
  if (error) throw error;
  return (data ?? []) as Fact[];
}

export async function getTips(agentId: string): Promise<{ topic: string; tip: string }[]> {
  const { data } = await adminClient().from("agent_tips").select("topic, tip").eq("agent_id", agentId).limit(200);
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
