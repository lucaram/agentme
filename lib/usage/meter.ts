import { currentUsageContext } from "./context";
import { costUsd, type TokenCounts } from "./pricing";

export type UsageEvent = TokenCounts & {
  purpose: string;
  provider: string;
  ok: boolean;
};

export type UsageRecord = UsageEvent & {
  costUsd: number;
  taskId: string | null;
  agentId: string | null;
  userId: string | null;
};

type Sink = (record: UsageRecord) => Promise<void>;

/** Default sink: the llm_usage table. Imported lazily to keep this module dependency-free. */
const databaseSink: Sink = async (r) => {
  const { adminClient } = await import("@/lib/supabase/admin");
  const { error } = await adminClient().from("llm_usage").insert({
    task_id: r.taskId,
    agent_id: r.agentId,
    user_id: r.userId,
    purpose: r.purpose,
    provider: r.provider,
    model: r.model,
    input_tokens: r.inputTokens,
    output_tokens: r.outputTokens,
    cache_read_tokens: r.cacheReadTokens ?? 0,
    cost_usd: r.costUsd,
    ok: r.ok,
  });
  if (error) throw error;
};

let sink: Sink = databaseSink;

/** Tests only: capture records in memory. Pass undefined to restore the database sink. */
export function setUsageSinkForTesting(next: Sink | undefined) {
  sink = next ?? databaseSink;
}

/**
 * Records one model call against the current usage context. Never throws:
 * losing a usage row must not break an agent's reply.
 */
export async function recordUsage(event: UsageEvent): Promise<void> {
  const ctx = currentUsageContext();
  const record: UsageRecord = {
    ...event,
    costUsd: costUsd(event),
    taskId: ctx.taskId ?? null,
    agentId: ctx.agentId ?? null,
    userId: ctx.userId ?? null,
  };
  try {
    await sink(record);
  } catch (error) {
    console.error("failed to record AI usage", error instanceof Error ? error.message : error);
  }
}
