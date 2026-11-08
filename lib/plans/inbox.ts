import "server-only";
import { z } from "zod";
import { adminClient } from "@/lib/supabase/admin";
import { asJson } from "@/lib/data/json";
import { getAgentById } from "@/lib/data/agents";
import { CoordinationReplySchema } from "@/lib/coordination/schemas";
import { isRequestableCategory } from "@/lib/policy/disclosure";
import type { InboxRequest } from "@/lib/agents/respond";
import { wakeTask } from "./engine";
import { addToBusinessInfo, relayTeamAnswer } from "@/lib/business/handoff";

export type InboxPayload = InboxRequest;
export type InfoRequestPayload = Extract<InboxRequest, { kind: "info_request" }>;
export type QuestionPayload = Extract<InboxRequest, { kind: "question" }>;

const InfoAnswers = z.record(z.string(), z.string().trim().max(200));
const QuestionAnswer = z.object({ answer: z.string().trim().min(1, "Write an answer, or choose “Don't answer”.").max(1000) });

type Result = { ok: true; wake: string | null } | { ok: false; error: string };

async function loadItem(itemId: string, ownerId: string) {
  const { data: item } = await adminClient().from("inbox_items").select("*").eq("id", itemId).maybeSingle();
  // Introductions have their own flow (lib/people/introductions.ts).
  if (!item || item.owner_id !== ownerId || item.kind === "introduction" || item.kind === "group_invite") return null;
  return item;
}

/** Payloads written before inbox items had a `kind` field inside. */
function payloadOf(item: { kind: string; payload: unknown }): InboxPayload {
  const p = item.payload as Record<string, unknown>;
  return (p.kind ? p : { ...p, kind: item.kind }) as InboxPayload;
}

/**
 * The owner answers a request their agent couldn't answer alone. The answer goes
 * back to the requesting agent, clearly marked as answered by the human.
 * For info requests, `remember` turns it into a standing permission: the agent
 * may share it automatically next time.
 */
export async function answerInboxItem(itemId: string, ownerId: string, raw: Record<string, string>, remember: boolean): Promise<Result> {
  const item = await loadItem(itemId, ownerId);
  if (!item) return { ok: false, error: "Not found." };
  if (item.status !== "open") return { ok: false, error: "This request is no longer open." };
  const payload = payloadOf(item);
  const agent = await getAgentById(item.agent_id);
  const db = adminClient();

  let response: { text: string; data: Record<string, unknown> };
  let disclosed: string[];
  let stored: Record<string, unknown>;

  if (payload.kind === "question") {
    const parsed = QuestionAnswer.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    response = { text: parsed.data.answer, data: { type: "agentme.question.answer", answer: parsed.data.answer } };
    disclosed = ["answer"];
    stored = { answer: parsed.data.answer };
    // Business: the team's answer goes back to the asker; optionally it becomes part of the business info.
    if (payload.business) {
      await relayTeamAnswer(item, parsed.data.answer);
      if (remember) await addToBusinessInfo(item.agent_id, payload.question, parsed.data.answer);
    }
    // Ask around: optionally keep the answer as a tip the agent may share by itself next time.
    if (remember && payload.ask_around) {
      await db.from("agent_tips").insert({ agent_id: item.agent_id, topic: payload.question.slice(0, 80), tip: parsed.data.answer.slice(0, 500) });
    }
  } else {
    const parsedAnswers = InfoAnswers.safeParse(raw);
    if (!parsedAnswers.success) return { ok: false, error: "Answers are too long." };
    const requested = payload.categories.filter(isRequestableCategory);
    const value = (c: (typeof requested)[number]) => parsedAnswers.data[c]?.trim() || payload.shareable[c] || null;
    if (!value("availability")) return { ok: false, error: "Add your availability, or choose “Don't share”." };
    const reply = CoordinationReplySchema.parse({
      availability: requested.includes("availability") ? value("availability") : null,
      food: requested.includes("food") ? value("food") : null,
      location: requested.includes("location") ? value("location") : null,
      summary: `@${agent?.handle ?? "they"} answered personally.`,
    });
    response = { text: reply.summary, data: { type: "agentme.coordination.reply", ...reply } };
    disclosed = requested.filter((c) => reply[c]);
    stored = { ...parsedAnswers.data, remember };

    if (remember) {
      // Standing permission: only what the owner typed here, never private notes.
      const remembered = requested.filter((c) => parsedAnswers.data[c]?.trim());
      if (remembered.length) {
        await db.from("agent_facts").upsert(
          remembered.map((category) => ({ agent_id: item.agent_id, category, value: parsedAnswers.data[category].trim(), disclosure: "contacts" as const })),
          { onConflict: "agent_id,category" },
        );
      }
    }
  }

  if (item.exchange_id) {
    await db
      .from("task_exchanges")
      .update({ status: "completed", answered_by: "human", response: asJson(response), disclosed_categories: disclosed, error: null })
      .eq("id", item.exchange_id)
      .eq("status", "waiting_human");
  }
  await db
    .from("inbox_items")
    .update({ status: "answered", answer: asJson(stored), answered_at: new Date().toISOString() })
    .eq("id", item.id)
    .eq("status", "open");
  return { ok: true, wake: item.task_id && (await wakeTask(item.task_id)) ? item.task_id : null };
}

/** The owner prefers not to share/answer: the requesting agent gets a refusal, nothing is disclosed. */
export async function declineInboxItem(itemId: string, ownerId: string): Promise<Result> {
  const item = await loadItem(itemId, ownerId);
  if (!item) return { ok: false, error: "Not found." };
  if (item.status !== "open") return { ok: false, error: "This request is no longer open." };
  const db = adminClient();
  const agent = await getAgentById(item.agent_id);
  const declined = payloadOf(item);
  const verb = declined.kind === "question" ? "answer" : "share";
  if (declined.kind === "question" && declined.business) await relayTeamAnswer(item, null);
  if (item.exchange_id) {
    await db
      .from("task_exchanges")
      .update({ status: "refused", answered_by: "human", error: `@${agent?.handle ?? "they"} preferred not to ${verb}.`, disclosed_categories: [] })
      .eq("id", item.exchange_id)
      .eq("status", "waiting_human");
  }
  await db.from("inbox_items").update({ status: "declined", answered_at: new Date().toISOString() }).eq("id", item.id).eq("status", "open");
  return { ok: true, wake: item.task_id && (await wakeTask(item.task_id)) ? item.task_id : null };
}

/** Closes open inbox requests for a task that was cancelled. */
export async function withdrawInboxForTask(taskId: string) {
  const db = adminClient();
  await db.from("inbox_items").update({ status: "withdrawn" }).eq("task_id", taskId).eq("status", "open");
  await db
    .from("task_exchanges")
    .update({ status: "failed", error: "The organiser cancelled the plan." })
    .eq("task_id", taskId)
    .eq("status", "waiting_human");
}

export { payloadOf as inboxPayloadOf };
