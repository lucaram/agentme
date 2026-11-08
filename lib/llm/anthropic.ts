import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { recordUsage } from "@/lib/usage/meter";
import { LLMError, type LLMObjectRequest, type LLMProvider, type LLMRequest, type LLMTier } from "./types";

// Main reasoning model, plus a cheaper worker for simple parsing.
// Both are overridable per deployment.
const MODELS: Record<LLMTier, string> = {
  smart: process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5",
  fast: process.env.ANTHROPIC_FAST_MODEL ?? "claude-haiku-5-5",
};

// Server-side refusal fallback is available for the Opus/Sonnet/Fable tiers,
// not Haiku.
function supportsServerFallback(model: string) {
  return !model.startsWith("claude-haiku");
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private readonly client = new Anthropic({ timeout: 60_000, maxRetries: 2 });

  private base(req: LLMRequest) {
    const model = MODELS[req.tier ?? "smart"];
    const fallback = supportsServerFallback(model);
    return {
      model,
      max_tokens: req.maxTokens ?? 4000,
      system: req.system,
      messages: withAttachments(req),
      // Short, bounded tasks: low effort keeps latency and cost down.
      output_config: { effort: "low" as const },
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    };
  }

  async generateText(req: LLMRequest): Promise<string> {
    try {
      const response = await this.client.beta.messages.create(this.base(req));
      await meter(req, response);
      if (response.stop_reason === "refusal") {
        throw new LLMError("The model declined this request.", "refusal");
      }
      return response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
    } catch (error) {
      throw wrap(error);
    }
  }

  async generateObject<T>(req: LLMObjectRequest<T>): Promise<T> {
    try {
      const base = this.base(req);
      const response = await this.client.beta.messages.parse({
        ...base,
        output_config: { ...base.output_config, format: betaZodOutputFormat(req.schema) },
      });
      await meter(req, response);
      if (response.stop_reason === "refusal") {
        throw new LLMError("The model declined this request.", "refusal");
      }
      const parsed = req.schema.safeParse(response.parsed_output);
      if (!parsed.success) throw new LLMError("Model output did not match schema.", "invalid_output");
      return parsed.data;
    } catch (error) {
      throw wrap(error);
    }
  }
}

/** Puts PDFs/images in front of the text of the last user message. */
function withAttachments(req: LLMRequest): Anthropic.Beta.BetaMessageParam[] {
  if (!req.attachments?.length) return req.messages;
  const files = req.attachments.map((f) =>
    f.mediaType === "application/pdf"
      ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.base64 } } as const)
      : ({ type: "image", source: { type: "base64", media_type: f.mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp", data: f.base64 } } as const),
  );
  return req.messages.map((m, i) =>
    i === req.messages.length - 1 && m.role === "user" ? { role: "user", content: [...files, { type: "text", text: m.content }] } : m,
  );
}

/**
 * Records what a call cost. With a server-side fallback, one call can be served
 * by more than one model; usage.iterations then breaks tokens down per model.
 */
async function meter(
  req: LLMRequest,
  response: { model: string; usage: Anthropic.Beta.BetaUsage; stop_reason: string | null },
) {
  const ok = response.stop_reason !== "refusal";
  type Entry = { model: string; input: number; output: number; cacheRead: number; cacheWrite: number };
  const parts: Entry[] = [];
  for (const raw of response.usage.iterations ?? []) {
    const i = raw as unknown as Partial<Record<string, unknown>>;
    if (typeof i.input_tokens !== "number" || typeof i.output_tokens !== "number") continue;
    parts.push({
      model: typeof i.model === "string" && i.model ? i.model : response.model,
      input: i.input_tokens,
      output: i.output_tokens,
      cacheRead: typeof i.cache_read_input_tokens === "number" ? i.cache_read_input_tokens : 0,
      cacheWrite: typeof i.cache_creation_input_tokens === "number" ? i.cache_creation_input_tokens : 0,
    });
  }
  const entries: Entry[] = parts.length
    ? parts
    : [
        {
          model: response.model,
          input: response.usage.input_tokens,
          output: response.usage.output_tokens,
          cacheRead: response.usage.cache_read_input_tokens ?? 0,
          cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
        },
      ];
  for (const e of entries) {
    await recordUsage({
      purpose: req.purpose,
      provider: "anthropic",
      model: e.model,
      inputTokens: e.input,
      outputTokens: e.output,
      cacheReadTokens: e.cacheRead,
      cacheWriteTokens: e.cacheWrite,
      ok,
    });
  }
}

function wrap(error: unknown): LLMError {
  if (error instanceof LLMError) return error;
  if (error instanceof Anthropic.AuthenticationError) {
    return new LLMError("Anthropic API key missing or invalid (set ANTHROPIC_API_KEY or LLM_PROVIDER=mock).", "api");
  }
  if (error instanceof Anthropic.RateLimitError) return new LLMError("AI provider is rate limiting; try again shortly.", "api");
  if (error instanceof Anthropic.APIError) return new LLMError(`AI provider error ${error.status ?? ""}`.trim(), "api");
  return new LLMError(error instanceof Error ? error.message : "Unknown AI provider error", "api");
}
