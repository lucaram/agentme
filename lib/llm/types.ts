import type { z } from "zod";

/**
 * Why the call is being made. Lets the mock provider produce deterministic,
 * purpose-specific output, and gives logs/cost tracking a stable label.
 */
export type LLMPurpose =
  | "intent" // parse an owner's request into a coordination task (legacy single-block)
  | "compose" // compose a plan from building blocks
  | "chat_assist" // @agent in a chat: summarise, translate, draft, answer (private to the owner)
  | "coordination_reply" // answer another agent's availability/preference request
  | "proposal" // turn collected replies into a plan
  | "owner_chat" // talk to the agent's own owner
  | "business_faq"; // answer a question from business-provided info only

export type LLMTier = "smart" | "fast";

export type LLMMessage = { role: "user" | "assistant"; content: string };

export interface LLMRequest {
  purpose: LLMPurpose;
  tier?: LLMTier;
  system: string;
  messages: LLMMessage[];
  maxTokens?: number;
  /**
   * Structured context the mock provider uses instead of reading prose.
   * Must contain nothing beyond what is already in `system`/`messages`.
   */
  mockContext?: unknown;
}

export interface LLMObjectRequest<T> extends LLMRequest {
  schema: z.ZodType<T>;
}

export interface LLMProvider {
  readonly name: string;
  generateText(req: LLMRequest): Promise<string>;
  generateObject<T>(req: LLMObjectRequest<T>): Promise<T>;
}

export class LLMError extends Error {
  constructor(message: string, readonly kind: "refusal" | "invalid_output" | "api") {
    super(message);
    this.name = "LLMError";
  }
}
