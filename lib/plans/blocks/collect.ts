import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { sendAgentMessage } from "@/lib/a2a/client";
import { asJson } from "@/lib/data/json";
import { getAgentByHandle, type AgentRow } from "@/lib/data/agents";
import { CoordinationReplySchema, type CoordinationRequest } from "@/lib/coordination/schemas";
import type { ParticipantReply } from "@/lib/coordination/heuristics";
import type { ExchangeRow, StepHandler, TaskParsed } from "../types";

export type CollectConfig = {
  categories: string[];
  participants: string[];
  /** Set when the organiser chose "continue without waiting". */
  proceedWithoutWaiting?: boolean;
};
export type CollectResult = { replies: ParticipantReply[] };

type Answer = { kind: "reply"; reply: ParticipantReply } | { kind: "none" } | { kind: "waiting" };

/**
 * Availability + Preference block: asks each participant's agent over A2A.
 * Agents answer within their owner's permissions; anything else goes to the
 * owner's inbox, and this step waits for them (resumable at any time).
 */
export const runCollect: StepHandler = async ({ task, step, organiser, parsed }) => {
  const config = step.config as unknown as CollectConfig;
  const { data: previous } = await adminClient().from("task_exchanges").select("*").eq("task_id", task.id).order("created_at");
  const request: CoordinationRequest = {
    type: "agentme.coordination.request",
    event: parsed.event,
    window: parsed.window,
    categories: config.categories ?? parsed.categories,
  };

  const answers = await Promise.all(
    (config.participants ?? parsed.participants).map((handle) =>
      askParticipant({ taskId: task.id, organiser, handle, request, parsed, previous: previous ?? [], proceed: Boolean(config.proceedWithoutWaiting) }),
    ),
  );

  if (answers.some((a) => a.kind === "waiting")) return { kind: "waiting", taskStatus: "waiting" };
  const replies = answers.flatMap((a) => (a.kind === "reply" ? [a.reply] : []));
  if (!replies.length) return { kind: "failed", error: "none of the agents replied." };
  return { kind: "done", result: { replies } satisfies CollectResult };
};

const toReply = (handle: string, data: unknown): Answer => {
  const reply = CoordinationReplySchema.safeParse(data);
  return reply.success ? { kind: "reply", reply: { handle, availability: reply.data.availability, food: reply.data.food, interests: reply.data.interests, budget: reply.data.budget, practical: reply.data.practical } } : { kind: "none" };
};

async function askParticipant(opts: {
  taskId: string;
  organiser: AgentRow;
  handle: string;
  request: CoordinationRequest;
  parsed: TaskParsed;
  previous: ExchangeRow[];
  proceed: boolean;
}): Promise<Answer> {
  const { taskId, organiser, handle, request, parsed, proceed } = opts;
  const db = adminClient();
  const target = await getAgentByHandle(handle);
  const prior = target ? opts.previous.filter((e) => e.to_agent === target.id) : [];

  // Reuse what already happened on an earlier run.
  const done = prior.find((e) => e.status === "completed");
  if (done) return toReply(handle, (done.response as { data?: unknown } | null)?.data);
  if (prior.some((e) => e.status === "refused")) return { kind: "none" }; // a refusal is final
  const waiting = prior.find((e) => e.status === "waiting_human");
  if (waiting) {
    if (!proceed) return { kind: "waiting" };
    await skipWaiting(waiting.id);
    return { kind: "none" };
  }
  const interrupted = prior.filter((e) => e.status === "pending").map((e) => e.id);
  if (interrupted.length) {
    await db
      .from("task_exchanges")
      .update({ status: "failed", error: "Interrupted (server restarted); retried." })
      .in("id", interrupted)
      .eq("status", "pending");
  }
  if (proceed && prior.length) return { kind: "none" }; // don't start new conversations once the organiser moved on

  const { data: exchange } = await db
    .from("task_exchanges")
    .insert({ task_id: taskId, from_agent: organiser.id, to_agent: target?.id ?? null, skill: "coordination.availability", request: asJson(request) })
    .select("id")
    .single();
  if (!target || !exchange) {
    if (exchange) await db.from("task_exchanges").update({ status: "failed", error: "Agent not found" }).eq("id", exchange.id);
    return { kind: "none" };
  }

  const started = Date.now();
  const result = await sendAgentMessage({
    fromAgentId: organiser.id,
    toHandle: handle,
    text: `@${organiser.handle}'s agent is organising ${parsed.event} (${parsed.window}). Could you share ${request.categories.join(", ")}?`,
    data: request,
    taskId,
    exchangeId: exchange.id,
  });
  const latency = Date.now() - started;

  if (!result.ok) {
    await db.from("task_exchanges").update({ status: "failed", error: result.error, latency_ms: latency }).eq("id", exchange.id).eq("status", "pending");
    return { kind: "none" };
  }
  await db.from("task_exchanges").update({ latency_ms: latency }).eq("id", exchange.id);
  // The recipient records the authoritative outcome (including "asked my human").
  const { data: recorded } = await db.from("task_exchanges").select("status").eq("id", exchange.id).single();
  if (recorded?.status === "waiting_human") return { kind: "waiting" };
  if (recorded?.status === "refused") return { kind: "none" };
  return toReply(handle, result.data);
}

/** The organiser stopped waiting for this person: close their open inbox request. */
async function skipWaiting(exchangeId: string) {
  const db = adminClient();
  await db
    .from("task_exchanges")
    .update({ status: "failed", error: "Skipped: the organiser continued without waiting." })
    .eq("id", exchangeId)
    .eq("status", "waiting_human");
  await db.from("inbox_items").update({ status: "withdrawn" }).eq("exchange_id", exchangeId).eq("status", "open");
}
