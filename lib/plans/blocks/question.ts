import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { sendAgentMessage } from "@/lib/a2a/client";
import { asJson } from "@/lib/data/json";
import { getAgentByHandle } from "@/lib/data/agents";
import { postMessage } from "@/lib/data/chat";
import type { QuestionRequest } from "@/lib/coordination/schemas";
import { updateStep } from "../steps";
import type { StepHandler } from "../types";

export type QuestionConfig = { question: string; participants: string[]; proceedWithoutWaiting?: boolean };
type AnswerState = { status: "answered" | "declined" | "no_reply"; answer?: string };
export type QuestionResult = { answers: Record<string, AnswerState>; posted: string[] };

const SKILL = "coordination.question";

/**
 * Question block: asks each person, through their agent, and relays their
 * answers to the organiser as they arrive. Free questions are always answered
 * by the person (their agent never guesses); only contacts can ask.
 */
export const runQuestion: StepHandler = async ({ task, step, organiser }) => {
  const db = adminClient();
  const config = step.config as unknown as QuestionConfig;
  const previousResult = (step.result as QuestionResult | null) ?? { answers: {}, posted: [] };
  const { data: previous } = await db.from("task_exchanges").select("*").eq("task_id", task.id).eq("skill", SKILL).order("created_at");
  const request: QuestionRequest = { type: "agentme.question", question: config.question };

  const answers: Record<string, AnswerState> = {};
  let waiting = false;

  for (const handle of config.participants) {
    const target = await getAgentByHandle(handle);
    const prior = target ? (previous ?? []).filter((e) => e.to_agent === target.id) : [];
    const done = prior.find((e) => e.status === "completed");
    if (done) {
      const answer = (done.response as { data?: { answer?: string }; text?: string } | null)?.data?.answer ?? (done.response as { text?: string } | null)?.text;
      answers[handle] = { status: "answered", answer: answer ?? "" };
      continue;
    }
    if (prior.some((e) => e.status === "refused")) {
      answers[handle] = { status: "declined" };
      continue;
    }
    const open = prior.find((e) => e.status === "waiting_human");
    if (open) {
      if (!config.proceedWithoutWaiting) {
        waiting = true;
        continue;
      }
      await db.from("task_exchanges").update({ status: "failed", error: "Skipped: the organiser stopped waiting." }).eq("id", open.id).eq("status", "waiting_human");
      await db.from("inbox_items").update({ status: "withdrawn" }).eq("exchange_id", open.id).eq("status", "open");
      answers[handle] = { status: "no_reply" };
      continue;
    }
    const interrupted = prior.filter((e) => e.status === "pending").map((e) => e.id);
    if (interrupted.length) {
      await db.from("task_exchanges").update({ status: "failed", error: "Interrupted (server restarted); retried." }).in("id", interrupted).eq("status", "pending");
    }
    if (!target || (config.proceedWithoutWaiting && prior.length)) {
      answers[handle] = { status: "no_reply" };
      continue;
    }

    const { data: exchange } = await db
      .from("task_exchanges")
      .insert({ task_id: task.id, from_agent: organiser.id, to_agent: target.id, skill: SKILL, request: asJson(request) })
      .select("id")
      .single();
    if (!exchange) {
      answers[handle] = { status: "no_reply" };
      continue;
    }
    const result = await sendAgentMessage({
      fromAgentId: organiser.id,
      toHandle: handle,
      text: `@${organiser.handle} asks: ${config.question}`,
      data: request,
      taskId: task.id,
      exchangeId: exchange.id,
    });
    if (!result.ok) {
      await db.from("task_exchanges").update({ status: "failed", error: result.error }).eq("id", exchange.id).eq("status", "pending");
      answers[handle] = { status: "no_reply" };
      continue;
    }
    const { data: recorded } = await db.from("task_exchanges").select("status").eq("id", exchange.id).single();
    if (recorded?.status === "waiting_human") waiting = true;
    else answers[handle] = { status: recorded?.status === "refused" ? "declined" : "no_reply" };
  }

  // Relay each answer to the organiser once, as soon as it is known.
  const posted = new Set(previousResult.posted);
  for (const [handle, state] of Object.entries(answers)) {
    if (posted.has(handle)) continue;
    const content =
      state.status === "answered"
        ? `💬 @${handle} answered personally: “${state.answer}”`
        : state.status === "declined"
          ? `@${handle} preferred not to answer.`
          : `@${handle} didn't answer.`;
    await postMessage({ conversationId: task.conversation_id, from: "agent", agentId: organiser.id, content, metadata: { kind: "answer", task_id: task.id } });
    posted.add(handle);
  }
  const result: QuestionResult = { answers, posted: [...posted] };
  await updateStep(step.id, { result });

  if (waiting) return { kind: "waiting", taskStatus: "waiting" };
  return { kind: "done", result };
};
