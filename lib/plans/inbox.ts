import "server-only";
import { z } from "zod";
import { adminClient } from "@/lib/supabase/admin";
import { asJson } from "@/lib/data/json";
import { getAgentById } from "@/lib/data/agents";
import { CoordinationReplySchema } from "@/lib/coordination/schemas";
import { isRequestableCategory, type RequestableCategory } from "@/lib/policy/disclosure";
import { wakeTask } from "./engine";

export type InboxPayload = {
  event: string;
  window: string;
  categories: string[];
  missing: RequestableCategory[];
  shareable: Partial<Record<RequestableCategory, string>>;
};

const Answers = z.record(z.string(), z.string().trim().max(200));

type Result = { ok: true; wake: string | null } | { ok: false; error: string };

async function loadOpenItem(itemId: string, ownerId: string) {
  const { data: item } = await adminClient().from("inbox_items").select("*").eq("id", itemId).maybeSingle();
  if (!item || item.owner_id !== ownerId) return null;
  return item;
}

/**
 * The owner answers a request their agent couldn't answer alone. Their answer
 * is sent back to the requesting agent as a normal coordination reply, clearly
 * marked as answered by the human. `remember` turns it into a standing
 * permission: the agent may share it automatically next time.
 */
export async function answerInboxItem(itemId: string, ownerId: string, rawAnswers: Record<string, string>, remember: boolean): Promise<Result> {
  const item = await loadOpenItem(itemId, ownerId);
  if (!item) return { ok: false, error: "Not found." };
  if (item.status !== "open") return { ok: false, error: "This request is no longer open." };
  const parsedAnswers = Answers.safeParse(rawAnswers);
  if (!parsedAnswers.success) return { ok: false, error: "Answers are too long." };

  const payload = item.payload as unknown as InboxPayload;
  const requested = payload.categories.filter(isRequestableCategory);
  const value = (c: RequestableCategory) => parsedAnswers.data[c]?.trim() || payload.shareable[c] || null;
  if (!value("availability")) return { ok: false, error: "Add your availability, or choose “Don't share”." };

  const agent = await getAgentById(item.agent_id);
  const reply = CoordinationReplySchema.parse({
    availability: requested.includes("availability") ? value("availability") : null,
    food: requested.includes("food") ? value("food") : null,
    location: requested.includes("location") ? value("location") : null,
    summary: `@${agent?.handle ?? "they"} answered personally.`,
  });
  const disclosed = requested.filter((c) => reply[c]);

  const db = adminClient();
  if (item.exchange_id) {
    await db
      .from("task_exchanges")
      .update({
        status: "completed",
        answered_by: "human",
        response: asJson({ text: reply.summary, data: { type: "agentme.coordination.reply", ...reply } }),
        disclosed_categories: disclosed,
        error: null,
      })
      .eq("id", item.exchange_id)
      .eq("status", "waiting_human");
  }
  await db
    .from("inbox_items")
    .update({ status: "answered", answer: asJson({ ...parsedAnswers.data, remember }), answered_at: new Date().toISOString() })
    .eq("id", item.id)
    .eq("status", "open");

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
  return { ok: true, wake: item.task_id && (await wakeTask(item.task_id)) ? item.task_id : null };
}

/** The owner prefers not to share: the requesting agent gets a refusal, nothing is disclosed. */
export async function declineInboxItem(itemId: string, ownerId: string): Promise<Result> {
  const item = await loadOpenItem(itemId, ownerId);
  if (!item) return { ok: false, error: "Not found." };
  if (item.status !== "open") return { ok: false, error: "This request is no longer open." };
  const db = adminClient();
  const agent = await getAgentById(item.agent_id);
  if (item.exchange_id) {
    await db
      .from("task_exchanges")
      .update({ status: "refused", answered_by: "human", error: `@${agent?.handle ?? "they"} preferred not to share.`, disclosed_categories: [] })
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
