import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { FACT_CATEGORIES, type FactCategory } from "@/lib/policy/disclosure";
import { MAX_CUSTOM_TOPICS, cleanLabel } from "./topics";

export type FactInput = { category: string; label?: string; value: string; share: boolean; expiresAt?: string | null };

/**
 * Saves (or, when empty, removes) one entry of what the agent knows about its
 * owner. Private notes can never be shared; your own topics need a name.
 */
export async function saveFact(agentId: string, input: FactInput): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(FACT_CATEGORIES as readonly string[]).includes(input.category)) return { ok: false, error: "Unknown topic." };
  const category = input.category as FactCategory;
  const label = category === "custom" ? cleanLabel(input.label ?? "") : "";
  if (category === "custom" && !label) return { ok: false, error: "Give your topic a name." };
  const value = input.value.trim().replace(/\s+\n/g, "\n").slice(0, 500);
  const db = adminClient();
  if (!value) {
    await db.from("agent_facts").delete().eq("agent_id", agentId).eq("category", category).eq("label", label);
    return { ok: true };
  }
  if (category === "custom") {
    const { data: existing } = await db.from("agent_facts").select("label").eq("agent_id", agentId).eq("category", "custom");
    const others = (existing ?? []).filter((e) => e.label.toLowerCase() !== label.toLowerCase());
    if (others.length >= MAX_CUSTOM_TOPICS) return { ok: false, error: `You can have up to ${MAX_CUSTOM_TOPICS} topics of your own.` };
    // Same name, different capitals: the same topic.
    const same = (existing ?? []).find((e) => e.label.toLowerCase() === label.toLowerCase() && e.label !== label);
    if (same) await db.from("agent_facts").delete().eq("agent_id", agentId).eq("category", "custom").eq("label", same.label);
  }
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now())) return { ok: false, error: "Pick a date in the future." };
  const { error } = await db.from("agent_facts").upsert(
    {
      agent_id: agentId,
      category,
      label,
      value,
      disclosure: category !== "notes" && input.share ? "contacts" : "private",
      expires_at: expiresAt?.toISOString() ?? null,
    },
    { onConflict: "agent_id,category,label" },
  );
  return error ? { ok: false, error: "Couldn't save. Please try again." } : { ok: true };
}

/** Adds to what's there ("Italian" + "vegetarian" → "Italian, vegetarian"), keeping its sharing. */
export async function appendToFact(agentId: string, category: FactCategory, addition: string, shareIfNew: boolean) {
  const { data: current } = await adminClient()
    .from("agent_facts")
    .select("value, disclosure")
    .eq("agent_id", agentId)
    .eq("category", category)
    .eq("label", "")
    .maybeSingle();
  const exists = current?.value?.toLowerCase().includes(addition.toLowerCase());
  const value = current ? (exists ? current.value : `${current.value.replace(/[,;.\s]+$/, "")}, ${addition}`) : addition;
  return saveFact(agentId, { category, value, share: current ? current.disclosure === "contacts" : shareIfNew });
}
