import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { asJson } from "@/lib/data/json";
import { getAgentByHandle, getAgentById, getContactRow, type AgentRow } from "@/lib/data/agents";
import { getOrCreateMyAgentConversation, postMessage } from "@/lib/data/chat";
import { describeRetry, hit } from "@/lib/limits";
import { normalizeHandle } from "@/lib/policy/handles";
import { connectPeople, openDmWithNote } from "./connect";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export type IntroductionPayload = { kind: "introduction"; introduction_id: string; other_agent: string; note: string | null };

/** The introduce command in My Agent: "introduce @luca to @paul" (also "and"/"with"). */
export function parseIntroduceCommand(text: string): { a: string; b: string; note: string | null } | null {
  const m = text.match(/^\s*introduce\s+@([a-z0-9_]{3,20})\s+(?:to|and|with)\s+@([a-z0-9_]{3,20})\b[\s,.:;!-]*([\s\S]*)$/i);
  if (!m) return null;
  const note = m[3].trim().slice(0, 280);
  return { a: m[1].toLowerCase(), b: m[2].toLowerCase(), note: note || null };
}

/**
 * The introducer (a contact of both) suggests two people meet. Each gets the
 * introduction in their Inbox; they become contacts only if BOTH accept.
 * If they are already connected (or one blocked the other) nothing is sent,
 * and the introducer is told the same thing either way, so it reveals nothing.
 */
export async function createIntroduction(introducer: AgentRow, aHandle: string, bHandle: string, note: string | null): Promise<Result> {
  const [a, b] = await Promise.all([getAgentByHandle(normalizeHandle(aHandle)), getAgentByHandle(normalizeHandle(bHandle))]);
  if (!a || !b) return { ok: false, error: "Choose two of your contacts." };
  if (a.id === b.id) return { ok: false, error: "Choose two different people." };
  if (a.id === introducer.id || b.id === introducer.id) return { ok: false, error: "Choose two other people: to connect with someone yourself, add them as a contact." };
  const [ra, rb] = await Promise.all([getContactRow(introducer.id, a.id), getContactRow(introducer.id, b.id)]);
  if (ra?.status !== "accepted" || rb?.status !== "accepted") return { ok: false, error: "You can only introduce people who are both your contacts." };
  const limit = await hit("introductionsPerAgent", introducer.id);
  if (!limit.allowed) return { ok: false, error: `Too many introductions. Try again in ${describeRetry(limit.retryAfterSeconds)}.` };

  const db = adminClient();
  if (await getContactRow(a.id, b.id)) return { ok: true };
  const { data: open } = await db
    .from("introductions")
    .select("id")
    .eq("status", "pending")
    .or(`and(a_agent.eq.${a.id},b_agent.eq.${b.id}),and(a_agent.eq.${b.id},b_agent.eq.${a.id})`)
    .limit(1);
  if (open?.length) return { ok: true };

  const cleanNote = note?.trim().slice(0, 280) || null;
  const { data: intro, error } = await db
    .from("introductions")
    .insert({ introducer_agent: introducer.id, a_agent: a.id, b_agent: b.id, note: cleanNote })
    .select("id")
    .single();
  if (error || !intro) return { ok: false, error: "Couldn't create the introduction." };
  const item = (to: AgentRow, other: AgentRow) => ({
    owner_id: to.owner_id,
    agent_id: to.id,
    from_agent: introducer.id,
    kind: "introduction",
    payload: asJson({ kind: "introduction", introduction_id: intro.id, other_agent: other.id, note: cleanNote } satisfies IntroductionPayload),
  });
  await db.from("inbox_items").insert([item(a, b), item(b, a)]);
  return { ok: true };
}

/**
 * One side answers. A "no" quietly ends it for both. When both say yes they
 * become contacts, get a direct chat, and the introducer is told.
 */
export async function answerIntroduction(itemId: string, ownerId: string, accept: boolean): Promise<Result<{ chatId?: string }>> {
  const db = adminClient();
  const { data: item } = await db.from("inbox_items").select("*").eq("id", itemId).maybeSingle();
  if (!item || item.owner_id !== ownerId || item.kind !== "introduction") return { ok: false, error: "Not found." };
  if (item.status !== "open") return { ok: false, error: "This introduction is no longer open." };
  const payload = item.payload as unknown as IntroductionPayload;
  const { data: intro } = await db.from("introductions").select("*").eq("id", payload.introduction_id).maybeSingle();
  if (!intro || intro.status !== "pending") return { ok: false, error: "This introduction is no longer open." };
  const side = intro.a_agent === item.agent_id ? "a" : intro.b_agent === item.agent_id ? "b" : null;
  const answer = (value: "accepted" | "declined") => (side === "a" ? { a_answer: value } : { b_answer: value });
  if (!side) return { ok: false, error: "Not found." };
  const now = new Date().toISOString();

  if (!accept) {
    await db.from("introductions").update({ ...answer("declined"), status: "declined" }).eq("id", intro.id).eq("status", "pending");
    await db.from("inbox_items").update({ status: "declined", answered_at: now }).eq("id", item.id);
    // The other person's open card just closes ("no longer available").
    await db.from("inbox_items").update({ status: "withdrawn" }).eq("kind", "introduction").eq("status", "open").eq("payload->>introduction_id", intro.id);
    return { ok: true };
  }

  await db.from("introductions").update(answer("accepted")).eq("id", intro.id).eq("status", "pending");
  await db.from("inbox_items").update({ status: "answered", answer: asJson({ accepted: true }), answered_at: now }).eq("id", item.id);
  const { data: latest } = await db.from("introductions").select("*").eq("id", intro.id).single();
  if (latest?.a_answer !== "accepted" || latest.b_answer !== "accepted") return { ok: true };
  // Both said yes: only the first to see it does the connecting.
  const { data: won } = await db.from("introductions").update({ status: "connected" }).eq("id", intro.id).eq("status", "pending").select("id");
  if (!won?.length) return { ok: true };

  const [a, b, introducer] = await Promise.all([getAgentById(intro.a_agent), getAgentById(intro.b_agent), getAgentById(intro.introducer_agent)]);
  if (!a || !b) return { ok: true };
  if (!(await connectPeople(a, b))) return { ok: true };
  const chatId = await openDmWithNote(a, b, `🤝 ${introducer?.display_name ?? "A friend"} introduced you. Say hi!`);
  if (introducer) {
    const conv = await getOrCreateMyAgentConversation(introducer.owner_id);
    await postMessage({
      conversationId: conv.id,
      from: "agent",
      agentId: introducer.id,
      content: `🤝 ${a.display_name} and ${b.display_name} accepted your introduction and are now connected.`,
      metadata: { kind: "info" },
    });
  }
  return { ok: true, chatId };
}
