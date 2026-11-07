import { AnthropicProvider } from "./anthropic";
import { MockProvider } from "./mock";
import type { LLMProvider } from "./types";

export * from "./types";

let override: LLMProvider | undefined;
let cached: LLMProvider | undefined;

/** The configured provider (LLM_PROVIDER=anthropic|mock). */
export function llm(): LLMProvider {
  if (override) return override;
  cached ??= process.env.LLM_PROVIDER === "mock" ? new MockProvider() : new AnthropicProvider();
  return cached;
}

/** Tests only: swap the provider (e.g. a recording wrapper). Pass undefined to reset. */
export function setLLMProviderForTesting(provider: LLMProvider | undefined) {
  override = provider;
}
