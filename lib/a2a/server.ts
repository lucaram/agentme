import "server-only";
import { businessSources } from "@/lib/business/sources";
import { NEEDS_ANSWER, tellOwner } from "@/lib/requests/notify";
import {
  A2A_VERSION_HEADER,
  AgentCard,
  TaskState,
  type Task,
} from "@a2a-js/sdk";
import {
  AgentEvent,
  DefaultRequestHandler,
  InMemoryTaskStore,
  JsonRpcTransportHandler,
  ServerCallContext,
  validateVersion,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import { env } from "@/lib/env";
import { adminClient } from "@/lib/supabase/admin";
import { getAgentByHandle, getAgentById, getFacts, getRelationship, getTips, type AgentRow } from "@/lib/data/agents";
import { respondAsAgent, type AgentResponse } from "@/lib/agents/respond";
import { buildAgentCard } from "./card";
import { verifyAgentToken } from "./auth";
import { buildMessage, dataPart, extractContent, textPart } from "./messages";
import type { Relationship } from "@/lib/policy/contactPolicy";
import { asJson } from "@/lib/data/json";
import { hit } from "@/lib/limits";
import { withUsageContext } from "@/lib/usage/context";

/** Best-effort client IP. Behind a proxy/host this is set by the platform; locally it's "local". */
function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}

// Tasks complete synchronously, so an in-memory store per process is enough for
// the MVP. Swap for @a2a-js/sdk/server/database to support getTask across restarts.
const taskStore = new InMemoryTaskStore();

function jsonRpcError(id: unknown, code: number, message: string, status = 200) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status });
}

type Caller = { agent: AgentRow | null; exchangeId?: string; taskId?: string };

/**
 * Handles one A2A JSON-RPC request addressed to `@handle`.
 * Authentication and contact policy are checked here, in code, before the
 * agent (and any model) runs.
 */
export async function handleA2ARequest(request: Request, handle: string): Promise<Response> {
  let body: { id?: unknown; method?: unknown } & Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonRpcError(null, -32700, "Parse error");
  }

  const recipient = await getAgentByHandle(handle);
  if (!recipient) return jsonRpcError(body.id, -32001, "Agent not found", 404);

  // --- Authentication: a present token must be valid; absent = anonymous caller.
  const authorization = request.headers.get("authorization");
  const caller: Caller = { agent: null };
  if (authorization) {
    const verified = await verifyAgentToken(authorization, recipient.handle, env.a2aSigningSecret);
    if (!verified.ok) return jsonRpcError(body.id, -32003, `Unauthorized (${verified.reason})`, 401);
    caller.agent = await getAgentById(verified.claims.sub);
    if (!caller.agent) return jsonRpcError(body.id, -32003, "Unauthorized (unknown agent)", 401);
    caller.exchangeId = verified.claims.xid;
    caller.taskId = verified.claims.tid;
  }

  // --- Rate limiting, before any work (and any model cost) happens.
  const limit = caller.agent
    ? await hit("a2aPerCaller", `${caller.agent.id}->${recipient.id}`)
    : await hit("a2aAnonymousPerIp", `${clientIp(request)}->${recipient.id}`);
  if (!limit.allowed) {
    return Response.json(
      { jsonrpc: "2.0", id: body.id ?? null, error: { code: -32005, message: "Rate limit exceeded" } },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const relationship: Relationship = caller.agent ? await getRelationship(caller.agent.id, recipient.id) : "none";
  const card = buildAgentCard(recipient, env.appUrl);

  const executor = new AgentmeExecutor(async (text, data) => {
    // Facts are loaded for the recipient only; respondAsAgent minimises them.
    const facts = recipient.type === "personal" ? await getFacts(recipient.id) : [];
    // Saved tips, only ever shared for an "ask around" whose topic matches one.
    const tips = recipient.type === "personal" ? await getTips(recipient.id) : [];
    // Business agents: text read from the business's own links. A question they can't
    // answer may go to the business's team, for signed-in agents only and rate-limited.
    const sources = recipient.type === "business" ? await businessSources(recipient.id) : [];
    const requestHandoff = async () =>
      Boolean(caller.agent) && (await hit("businessHandoffsPerCaller", `${caller.agent!.id}:${recipient.id}`)).allowed;
    // AI cost of this reply is attributed to the recipient's owner and, when the
    // platform-signed token names one, to the coordination task it serves.
    return withUsageContext({ taskId: caller.taskId ?? null, agentId: recipient.id, userId: recipient.owner_id }, () =>
      respondAsAgent(recipient, { callerHandle: caller.agent?.handle ?? null, relationship, text, data }, facts, tips, { sources, requestHandoff }),
    );
  }, (response, a2aTaskId, requestData) => recordExchange(recipient, caller, response, a2aTaskId, requestData));

  const handler = new DefaultRequestHandler(card, taskStore, executor);
  const context = new ServerCallContext({
    requestedVersion: request.headers.get(A2A_VERSION_HEADER) ?? undefined,
  });

  try {
    validateVersion(context.requestedVersion, card, "JSONRPC");
    const result = await new JsonRpcTransportHandler(handler).handle(body, context);
    if (result && typeof (result as AsyncGenerator)[Symbol.asyncIterator] === "function") {
      return jsonRpcError(body.id, -32004, "Streaming is not supported by this agent");
    }
    return Response.json(result);
  } catch (error) {
    return Response.json({ jsonrpc: "2.0", id: body.id ?? null, error: JsonRpcTransportHandler.mapToJSONRPCError(error) });
  }
}

class AgentmeExecutor implements AgentExecutor {
  constructor(
    private readonly respond: (text: string, data: Record<string, unknown> | null) => Promise<AgentResponse>,
    private readonly onComplete: (
      response: AgentResponse | { status: "failed"; error: string },
      a2aTaskId: string,
      requestData: Record<string, unknown> | null,
    ) => Promise<void>,
  ) {}

  async execute(ctx: RequestContext, bus: ExecutionEventBus): Promise<void> {
    const { text, data } = extractContent(ctx.userMessage.parts);
    let task: Task;
    try {
      const response = await this.respond(text, data);
      const reply = buildMessage({
        role: "agent",
        contextId: ctx.contextId,
        taskId: ctx.taskId,
        parts: [textPart(response.text), ...(response.status === "completed" && response.data ? [dataPart(response.data)] : [])],
      });
      task = {
        id: ctx.taskId,
        contextId: ctx.contextId,
        status: {
          state:
            response.status === "completed"
              ? TaskState.TASK_STATE_COMPLETED
              : response.status === "needs_human"
                ? // Still in progress: the owner answers later via their inbox.
                  TaskState.TASK_STATE_WORKING
                : TaskState.TASK_STATE_REJECTED,
          message: reply,
          timestamp: new Date().toISOString(),
        },
        artifacts:
          response.status === "completed" && response.data
            ? [{ artifactId: crypto.randomUUID(), name: "reply", description: "", parts: [dataPart(response.data)], metadata: undefined, extensions: [] }]
            : [],
        history: [ctx.userMessage],
        metadata: { skill: response.skill, disclosed: response.disclosed },
      };
      await this.onComplete(response, ctx.taskId, data ?? { text });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Agent error";
      task = {
        id: ctx.taskId,
        contextId: ctx.contextId,
        status: {
          state: TaskState.TASK_STATE_FAILED,
          message: buildMessage({ role: "agent", contextId: ctx.contextId, taskId: ctx.taskId, parts: [textPart("The agent could not complete this request.")] }),
          timestamp: new Date().toISOString(),
        },
        artifacts: [],
        history: [ctx.userMessage],
        metadata: undefined,
      };
      await this.onComplete({ status: "failed", error: message }, ctx.taskId, data ?? { text }).catch(() => {});
    }
    bus.publish(AgentEvent.task(task));
    bus.finished();
  }

  async cancelTask(taskId: string, bus: ExecutionEventBus): Promise<void> {
    // Tasks complete within a single request; nothing long-running to cancel.
    bus.finished();
    void taskId;
  }
}

/**
 * The RECIPIENT side writes the audit row: it is the authority on what its
 * agent actually disclosed. Exchanges started by AGENTME's orchestrator carry
 * a signed exchange id (xid) so the pre-created row is completed in place.
 */
async function recordExchange(
  recipient: AgentRow,
  caller: Caller,
  response: AgentResponse | { status: "failed"; error: string },
  a2aTaskId: string,
  requestData: Record<string, unknown> | null,
) {
  const db = adminClient();
  const row = {
    status: response.status === "needs_human" ? ("waiting_human" as const) : response.status,
    answered_by: response.status === "completed" ? "agent" : null,
    response: asJson(
      response.status === "failed"
        ? null
        : { text: response.text, ...(response.status === "completed" && response.data ? { data: response.data } : {}) },
    ),
    disclosed_categories: response.status === "completed" ? response.disclosed : [],
    error: response.status === "failed" ? response.error : response.status === "refused" ? response.reason : null,
    a2a_task_id: a2aTaskId,
  };

  let exchangeId: string | null = null;
  if (caller.exchangeId && caller.agent) {
    const { data } = await db
      .from("task_exchanges")
      .update(row)
      .eq("id", caller.exchangeId)
      .eq("from_agent", caller.agent.id)
      .eq("to_agent", recipient.id)
      .select("id");
    exchangeId = data?.[0]?.id ?? null;
  }
  if (!exchangeId) {
    const { data } = await db
      .from("task_exchanges")
      .insert({
        ...row,
        task_id: null,
        from_agent: caller.agent?.id ?? null,
        to_agent: recipient.id,
        skill: response.status === "failed" ? "unknown" : response.skill,
        request: asJson(requestData ?? {}),
      })
      .select("id")
      .single();
    exchangeId = data?.id ?? null;
  }

  if (response.status === "needs_human" && exchangeId) {
    // Hand the request to the recipient's owner. Prefill: what the agent could share
    // anyway; the owner's private values are added only when the owner opens the item.
    const { data: created } = await db
      .from("inbox_items")
      .upsert(
        {
          owner_id: recipient.owner_id,
          agent_id: recipient.id,
          from_agent: caller.agent?.id ?? null,
          task_id: caller.taskId ?? null,
          exchange_id: exchangeId,
          kind: response.inbox.kind,
          payload: asJson(response.inbox),
        },
        { onConflict: "exchange_id", ignoreDuplicates: true },
      )
      .select("id");
    if (created?.length) {
      const from = caller.agent ? `@${caller.agent.handle}` : "Someone";
      const what =
        response.inbox.kind === "question"
          ? response.inbox.business
            ? `🏪 ${from} asked ${recipient.display_name}: “${response.inbox.question}” Your agent didn't have the answer in your business info.`
            : response.inbox.ask_around
            ? `🔎 ${from} is asking around: “${response.inbox.question}” Share a tip if you have one.`
            : `🔔 ${from} asks you: “${response.inbox.question}”.`
          : `🔔 ${from}'s agent is organising ${response.inbox.event} and needs something only you can share.`;
      await tellOwner(recipient.owner_id, recipient.id, `${what} ${NEEDS_ANSWER}`);
    }
  }
}

export async function agentCardResponse(handle: string): Promise<Response> {
  const agent = await getAgentByHandle(handle);
  if (!agent) return Response.json({ error: "Agent not found" }, { status: 404 });
  return Response.json(AgentCard.toJSON(buildAgentCard(agent, env.appUrl)), {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
