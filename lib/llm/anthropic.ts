import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
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
      messages: req.messages,
      // Short, bounded tasks: low effort keeps latency and cost down.
      output_config: { effort: "low" as const },
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    };
  }

  async generateText(req: LLMRequest): Promise<string> {
    try {
      const response = await this.client.beta.messages.create(this.base(req));
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

function wrap(error: unknown): LLMError {
  if (error instanceof LLMError) return error;
  if (error instanceof Anthropic.AuthenticationError) {
    return new LLMError("Anthropic API key missing or invalid (set ANTHROPIC_API_KEY or LLM_PROVIDER=mock).", "api");
  }
  if (error instanceof Anthropic.RateLimitError) return new LLMError("AI provider is rate limiting; try again shortly.", "api");
  if (error instanceof Anthropic.APIError) return new LLMError(`AI provider error ${error.status ?? ""}`.trim(), "api");
  return new LLMError(error instanceof Error ? error.message : "Unknown AI provider error", "api");
}
