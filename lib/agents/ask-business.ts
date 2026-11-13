import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { sendAgentMessage } from "@/lib/a2a/client";
import { getAgentById, type AgentRow } from "@/lib/data/agents";
import { postMessage } from "@/lib/data/chat";
import { looksLikeQuestion, matchBusinessName, nameCandidates } from "./business-mention";
import { researchWeb } from "@/lib/research";
import { answerMessage } from "@/lib/research/answer";
import { hit } from "@/lib/limits";
import { isPublicDomain } from "@/lib/business/site";

/**
 * Your agent asks a business's agent for you (over A2A, exactly like asking it
 * in its own chat) and brings the answer back into My Agent. Only your
 * question is sent, never anything from your profile. If the business's
 * agent doesn't know, its team answers later in the same My Agent thread.
 */

export const MAX_BUSINESSES_PER_MESSAGE = 3;

type Business = Pick<AgentRow, "id" | "handle" | "display_name">;

export async function askBusinessFor(opts: { agent: AgentRow; conversationId: string; business: Business; question: string; threadId?: string | null }) {
  const { agent, business } = opts;
  const result = await sendAgentMessage({ fromAgentId: agent.id, toHandle: business.handle, text: opts.question.trim().slice(0, 1000) });
  // Its agent can't be reached: look on the business's own website instead, and say that's where it's from.
  if (!result.ok) {
    const { data: site } = await adminClient().from("business_sites").select("domain, live_at").eq("agent_id", business.id).maybeSingle();
    if (site?.live_at && isPublicDomain(site.domain) && (await hit("researchPerUser", agent.owner_id)).allowed) {
      const found = await researchWeb({ question: opts.question.trim().slice(0, 500), allowedDomains: [site.domain] });
      if (found.status === "answered" || found.status === "partial") {
        await postMessage({
          conversationId: opts.conversationId,
          threadId: opts.threadId ?? undefined,
          from: "agent",
          agentId: agent.id,
          content: `I couldn't reach @${business.handle}'s agent just now, so I looked on its website instead (this is from the web, not from its agent):\n\n${answerMessage(found)}`,
          metadata: { kind: "research_answer", research: found.status, sources: found.sources.slice(0, 3), business_id: business.id, handle: business.handle },
        });
        return;
      }
    }
  }
  await postMessage({
    conversationId: opts.conversationId,
    threadId: opts.threadId ?? undefined,
    from: "agent",
    agentId: agent.id,
    content: result.ok
      ? `🏪 I asked @${business.handle}:\n\n${result.text.trim() || "(no answer)"}`
      : `I couldn't reach @${business.handle} just now (${result.error}). You can ask it directly from its page.`,
    // The A2A task links a later answer from the business's team back to this thread.
    metadata: { kind: "business_answer", business_id: business.id, handle: business.handle, ...(result.ok && result.taskId ? { a2a_task: result.taskId } : {}) },
  });
}

/** Several businesses @mentioned in one question: each is asked (up to three). */
export async function askBusinessesFor(agent: AgentRow, conversationId: string, businesses: Business[], question: string) {
  for (const business of businesses.slice(0, MAX_BUSINESSES_PER_MESSAGE)) await askBusinessFor({ agent, conversationId, business, question });
}

/** A business on AGENTME named (without @) in a question, if any. */
export async function businessNamedIn(text: string, selfId: string): Promise<Business | null> {
  if (!looksLikeQuestion(text)) return null;
  const words = nameCandidates(text);
  if (!words.length) return null;
  // Words are [a-z0-9] only, so they're safe in the filter.
  const filter = [...words.map((w) => `handle.eq.${w}`), ...words.map((w) => `display_name.ilike.%${w}%`)].join(",");
  const { data } = await adminClient().from("agents").select("id, handle, display_name").eq("type", "business").eq("guest", false).neq("id", selfId).or(filter).limit(20);
  return matchBusinessName(text, data ?? []);
}

/** After your agent's reply: "Everyeye Videogiochi is on AGENTME. Shall I ask its agent?" (asked only if you tap). */
export async function offerToAskBusiness(agent: AgentRow, conversationId: string, text: string) {
  if (agent.type !== "personal") return;
  const business = await businessNamedIn(text, agent.id);
  if (!business) return;
  await postMessage({
    conversationId,
    from: "agent",
    agentId: agent.id,
    content: `🏪 ${business.display_name} (@${business.handle}) is on AGENTME. Shall I ask its agent? Only your question is sent.`,
    metadata: { kind: "business_suggestion", business_id: business.id, handle: business.handle, question: text.slice(0, 1000) },
  });
}

/** Your tap on "Ask @…" (or "No thanks") under that offer, in your own My Agent. */
export async function answerBusinessSuggestion(userId: string, agent: AgentRow, messageId: string, ask: boolean): Promise<{ ok: boolean; error?: string }> {
  const db = adminClient();
  const { data: msg } = await db.from("messages").select("id, metadata, conversation_id, sender_agent_id, thread_id").eq("id", messageId).maybeSingle();
  const meta = (msg?.metadata ?? {}) as { kind?: string; business_id?: string; question?: string; decided?: string };
  if (!msg || meta.kind !== "business_suggestion" || !meta.business_id || !meta.question || msg.sender_agent_id !== agent.id) return { ok: false, error: "Not found." };
  const { data: conv } = await db.from("conversations").select("kind, created_by").eq("id", msg.conversation_id).single();
  if (conv?.kind !== "my_agent" || conv.created_by !== userId) return { ok: false, error: "Not found." };
  if (meta.decided) return { ok: true };
  await db.from("messages").update({ metadata: { ...meta, decided: ask ? "asked" : "dismissed" } }).eq("id", messageId);
  if (!ask) return { ok: true };
  const business = await getAgentById(meta.business_id);
  if (!business || business.type !== "business") return { ok: false, error: "That business isn't on AGENTME any more." };
  await askBusinessFor({ agent, conversationId: msg.conversation_id, business, question: meta.question, threadId: msg.thread_id });
  return { ok: true };
}

/**
 * The business's team answered a question your agent asked from My Agent:
 * the answer goes into that same thread. Returns false when the question
 * wasn't asked from My Agent (it then goes to the chat with the business).
 */
export async function relayToMyAgent(a2aTaskId: string | null, business: Business, answer: string | null): Promise<boolean> {
  if (!a2aTaskId) return false;
  const { data: asked } = await adminClient()
    .from("messages")
    .select("conversation_id, thread_id, sender_agent_id")
    .eq("metadata->>kind", "business_answer")
    .eq("metadata->>a2a_task", a2aTaskId)
    .limit(1)
    .maybeSingle();
  if (!asked?.sender_agent_id) return false;
  await postMessage({
    conversationId: asked.conversation_id,
    threadId: asked.thread_id ?? undefined,
    from: "agent",
    agentId: asked.sender_agent_id,
    content: answer
      ? `👤 The team at ${business.display_name} answered: ${answer}`
      : `The team at ${business.display_name} couldn't answer this one. You can contact them directly.`,
    metadata: { kind: "business_answer", business_id: business.id, handle: business.handle },
  });
  return true;
}
