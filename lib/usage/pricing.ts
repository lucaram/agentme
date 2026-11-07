/**
 * USD per 1M tokens (Anthropic first-party list prices). Cache writes are
 * billed at 1.25x input. Update when prices change; unknown models are priced
 * at the default (most expensive in-use) rate so costs are never under-reported.
 */
type Price = { input: number; output: number; cacheRead: number };

const PRICES: Record<string, Price> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  mock: { input: 0, output: 0, cacheRead: 0 },
};
const DEFAULT_PRICE = PRICES["claude-fable-5-1"];

export type TokenCounts = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

export function priceFor(model: string): { price: Price; known: boolean } {
  const known = PRICES[model];
  return known ? { price: known, known: true } : { price: DEFAULT_PRICE, known: false };
}

export function costUsd(counts: TokenCounts): number {
  const { price } = priceFor(counts.model);
  const cost =
    (counts.inputTokens * price.input +
      (counts.cacheWriteTokens ?? 0) * price.input * 1.25 +
      (counts.cacheReadTokens ?? 0) * price.cacheRead +
      counts.outputTokens * price.output) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export function formatUsd(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}
