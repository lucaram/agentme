import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { postMessage } from "@/lib/data/chat";
import type { AgentRow } from "@/lib/data/agents";
import { suggestFact, type FactSuggestion } from "./suggest";
import { appendToFact, saveFact } from "./save";

/** Shared by default when saved from a suggestion (sensitive topics stay private). */
const SHARE: Record<FactSuggestion["category"], boolean> = { food: true, interests: true, away: true, location: false, practical: false };

/**
 * You told your agent something about yourself ("I'm vegetarian now"): it
 * offers to remember it in your profile. Nothing is saved until you tap Save.
 */
export async function offerProfileSave(agent: AgentRow, conversationId: string, text: string) {
  if (agent.type !== "personal") return;
  const suggestion = suggestFact(text, new Date());
  if (!suggestion) return;
  // Already known: don't ask.
  const { data: current } = await adminClient().from("agent_facts").select("value").eq("agent_id", agent.id).eq("category", suggestion.category).eq("label", "").maybeSingle();
  if (current?.value.toLowerCase().includes(suggestion.value.toLowerCase())) return;
  const what = suggestion.category === "away" ? suggestion.value.split(":")[0] : `“${suggestion.value}”`;
  await postMessage({
    conversationId,
    from: "agent",
    agentId: agent.id,
    content: `💡 Shall I remember ${what} in ${suggestion.topic}? It helps me plan for you.`,
    metadata: { kind: "fact_suggestion", suggestion },
  });
}

/** Save (or dismiss) a suggestion from your own My Agent. */
export async function answerSuggestion(userId: string, agent: AgentRow, messageId: string, accept: boolean): Promise<{ ok: boolean; error?: string }> {
  const db = adminClient();
  const { data: msg } = await db.from("messages").select("id, metadata, conversation_id, sender_agent_id").eq("id", messageId).maybeSingle();
  const meta = (msg?.metadata ?? {}) as { kind?: string; suggestion?: FactSuggestion; decided?: string };
  if (!msg || meta.kind !== "fact_suggestion" || !meta.suggestion || msg.sender_agent_id !== agent.id) return { ok: false, error: "Not found." };
  const { data: conv } = await db.from("conversations").select("kind, created_by").eq("id", msg.conversation_id).single();
  if (conv?.kind !== "my_agent" || conv.created_by !== userId) return { ok: false, error: "Not found." };
  if (meta.decided) return { ok: true };

  if (accept) {
    const s = meta.suggestion;
    const result =
      s.category === "away"
        ? await saveFact(agent.id, { category: "away", value: s.value, share: SHARE.away, expiresAt: s.until ? `${s.until}T23:59:59Z` : null })
        : s.category === "location"
          ? await saveFact(agent.id, { category: "location", value: s.value, share: SHARE.location })
          : await appendToFact(agent.id, s.category, s.value, SHARE[s.category]);
    if (!result.ok) return result;
  }
  await db.from("messages").update({ metadata: { ...meta, decided: accept ? "saved" : "dismissed" } }).eq("id", messageId);
  return { ok: true };
}
