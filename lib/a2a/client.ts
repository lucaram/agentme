import "server-only";
import { ClientFactory } from "@a2a-js/sdk/client";
import { env } from "@/lib/env";
import { agentEndpoint } from "./card";
import { signAgentToken } from "./auth";
import { buildMessage, dataPart, extractResult, textPart } from "./messages";

export type A2ASendResult =
  | { ok: true; text: string; data: Record<string, unknown> | null; state: string; taskId: string | null }
  | { ok: false; error: string };

/**
 * Sends one A2A message from an AGENTME agent to another agent over real HTTP
 * using the official SDK client, authenticated with a platform-signed token.
 */
export async function sendAgentMessage(opts: {
  fromAgentId: string;
  toHandle: string;
  text: string;
  data?: Record<string, unknown>;
  taskId?: string;
  exchangeId?: string;
  timeoutMs?: number;
}): Promise<A2ASendResult> {
  try {
    const token = await signAgentToken(
      { sub: opts.fromAgentId, recipient: opts.toHandle, tid: opts.taskId, xid: opts.exchangeId },
      env.a2aSigningSecret,
    );
    const client = await new ClientFactory().createFromUrl(`${agentEndpoint(env.appUrl, opts.toHandle)}/`);
    const message = buildMessage({
      role: "user",
      parts: [textPart(opts.text), ...(opts.data ? [dataPart(opts.data)] : [])],
    });
    const result = await client.sendMessage(
      { tenant: "", message, configuration: undefined, metadata: undefined },
      {
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
        serviceParameters: { Authorization: `Bearer ${token}` },
      },
    );
    return { ok: true, ...extractResult(result) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: /abort|timeout/i.test(message) ? "Timed out waiting for the agent." : message };
  }
}
