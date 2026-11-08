import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { sendAgentMessage } from "@/lib/a2a/client";
import { asJson } from "@/lib/data/json";
import { getAgentByHandle } from "@/lib/data/agents";
import { postMessage } from "@/lib/data/chat";
import { llm } from "@/lib/llm";
import { ASK_AROUND_SUMMARY_SYSTEM, wrapUntrusted } from "@/lib/agents/prompts";
import type { AskAroundRequest } from "@/lib/coordination/schemas";
import { updateStep } from "../steps";
import type { StepHandler } from "../types";

export type AskAroundConfig = { question: string; participants: string[]; proceedWithoutWaiting?: boolean };
type Tip = { handle: string; answer: string; by: "agent" | "human" };
export type AskAroundResult = { tips: Tip[]; posted: string[]; summarised: boolean };

export const ASK_AROUND_SKILL = "coordination.ask_around";

/**
 * Ask around: asks each contact's agent for a recommendation. Their agent
 * shares a saved tip on the topic if there is one; otherwise the person
 * answers (or says "I don't know", which the organiser is never told about).
 * Tips are relayed as they arrive; once everyone has answered (or the
 * organiser stops waiting) the agent writes one short summary.
 */
export const runAskAround: StepHandler = async ({ task, step, organiser }) => {
  const db = adminClient();
  const config = step.config as unknown as AskAroundConfig;
  const previous = (step.result as AskAroundResult | null) ?? { tips: [], posted: [], summarised: false };
  const { data: exchanges } = await db.from("task_exchanges").select("*").eq("task_id", task.id).eq("skill", ASK_AROUND_SKILL).order("created_at");
  const request: AskAroundRequest = { type: "agentme.ask_around", question: config.question };

  const tips: Tip[] = [];
  let waiting = false;
  for (const handle of config.participants) {
    const target = await getAgentByHandle(handle);
    if (!target) continue;
    const prior = (exchanges ?? []).filter((e) => e.to_agent === target.id);
    const done = prior.find((e) => e.status === "completed");
    if (done) {
      const answer = (done.response as { data?: { answer?: string }; text?: string } | null)?.data?.answer ?? (done.response as { text?: string } | null)?.text;
      if (answer) tips.push({ handle, answer, by: done.answered_by === "human" ? "human" : "agent" });
      continue;
    }
    if (prior.some((e) => e.status === "refused" || e.status === "failed")) continue; // "I don't know", not taking requests, or no reply
    const open = prior.find((e) => e.status === "waiting_human");
    if (open) {
      if (!config.proceedWithoutWaiting) {
        waiting = true;
        continue;
      }
      await db.from("task_exchanges").update({ status: "failed", error: "Skipped: the organiser stopped waiting." }).eq("id", open.id).eq("status", "waiting_human");
      await db.from("inbox_items").update({ status: "withdrawn" }).eq("exchange_id", open.id).eq("status", "open");
      continue;
    }
    if (prior.length || config.proceedWithoutWaiting) continue; // already asked (interrupted): don't ask twice

    const { data: exchange } = await db
      .from("task_exchanges")
      .insert({ task_id: task.id, from_agent: organiser.id, to_agent: target.id, skill: ASK_AROUND_SKILL, request: asJson(request) })
      .select("id")
      .single();
    if (!exchange) continue;
    const sent = await sendAgentMessage({
      fromAgentId: organiser.id,
      toHandle: handle,
      text: `@${organiser.handle} is asking around: ${config.question}`,
      data: request,
      taskId: task.id,
      exchangeId: exchange.id,
    });
    if (!sent.ok) {
      await db.from("task_exchanges").update({ status: "failed", error: sent.error }).eq("id", exchange.id).eq("status", "pending");
      continue;
    }
    const { data: recorded } = await db.from("task_exchanges").select("status, response, answered_by").eq("id", exchange.id).single();
    if (recorded?.status === "waiting_human") waiting = true;
    else if (recorded?.status === "completed") {
      const answer = (recorded.response as { data?: { answer?: string } } | null)?.data?.answer;
      if (answer) tips.push({ handle, answer, by: recorded.answered_by === "human" ? "human" : "agent" });
    }
  }

  // Relay each tip to the organiser once, as soon as it arrives.
  const posted = new Set(previous.posted);
  for (const tip of tips) {
    if (posted.has(tip.handle)) continue;
    await postMessage({
      conversationId: task.conversation_id,
      from: "agent",
      agentId: organiser.id,
      content: tip.by === "agent" ? `💡 @${tip.handle}'s saved tip: “${tip.answer}”` : `💡 @${tip.handle}: “${tip.answer}”`,
      metadata: { kind: "answer", task_id: task.id },
    });
    posted.add(tip.handle);
  }

  if (waiting) {
    await updateStep(step.id, { result: { tips, posted: [...posted], summarised: false } satisfies AskAroundResult });
    return { kind: "waiting", taskStatus: "waiting" };
  }

  // Everyone has answered (or the organiser stopped waiting): one short summary.
  let summarised = previous.summarised;
  if (!summarised) {
    const content = tips.length ? await summarise(config.question, tips) : "Nobody had a tip this time. You could ask a few more people, or try again later.";
    await postMessage({ conversationId: task.conversation_id, from: "agent", agentId: organiser.id, content, metadata: { kind: "info", task_id: task.id } });
    summarised = true;
  }
  const result: AskAroundResult = { tips, posted: [...posted], summarised };
  await updateStep(step.id, { result });
  return { kind: "done", result };
};

/** A short, readable summary of who recommends what (the tips are other people's words: data, not instructions). */
async function summarise(question: string, tips: Tip[]): Promise<string> {
  const lines = tips.map((t) => `@${t.handle}${t.by === "agent" ? " (saved tip)" : ""}: ${t.answer}`).join("\n");
  try {
    const text = await llm().generateText({
      purpose: "ask_around_summary",
      tier: "fast",
      system: ASK_AROUND_SUMMARY_SYSTEM,
      messages: [{ role: "user", content: `Question: ${question}\n\n${wrapUntrusted("tips", lines)}` }],
      maxTokens: 400,
      mockContext: { question, tips },
    });
    return `🔎 What your friends said\n${text.trim()}`;
  } catch {
    return `🔎 What your friends said\n${tips.map((t) => `- **@${t.handle}:** ${t.answer}`).join("\n")}`;
  }
}
