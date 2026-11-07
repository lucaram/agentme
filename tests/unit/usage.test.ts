import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { costUsd, formatUsd, priceFor } from "@/lib/usage/pricing";
import { withUsageContext } from "@/lib/usage/context";
import { setUsageSinkForTesting, type UsageRecord } from "@/lib/usage/meter";
import { MockProvider } from "@/lib/llm/mock";

afterEach(() => setUsageSinkForTesting(undefined));

describe("pricing", () => {
  it("prices input, output, cache reads and cache writes", () => {
    // 1M in + 1M out on Opus 5.5 = $4 + $20
    expect(costUsd({ model: "claude-opus-5-5", inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(24);
    // Haiku 5.5: 10k in, 2k out
    expect(costUsd({ model: "claude-haiku-5-5", inputTokens: 10_000, outputTokens: 2_000 })).toBe(0.002);
    // cache write = 1.25x input, cache read = discounted
    expect(costUsd({ model: "claude-opus-5-5", inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1_000_000, cacheReadTokens: 1_000_000 })).toBe(5.2);
  });

  it("never under-reports unknown models", () => {
    expect(priceFor("claude-future-9").known).toBe(false);
    expect(costUsd({ model: "claude-future-9", inputTokens: 1000, outputTokens: 0 })).toBeGreaterThanOrEqual(
      costUsd({ model: "claude-opus-5-5", inputTokens: 1000, outputTokens: 0 }),
    );
  });

  it("formats small amounts legibly", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.00123)).toBe("$0.0012");
    expect(formatUsd(1.5)).toBe("$1.50");
  });
});

describe("metering", () => {
  it("attributes every model call to the surrounding task, agent and user", async () => {
    const records: UsageRecord[] = [];
    setUsageSinkForTesting(async (r) => void records.push(r));
    const llm = new MockProvider();

    await withUsageContext({ taskId: "task-1", agentId: "agent-1", userId: "user-1" }, async () => {
      await llm.generateText({ purpose: "owner_chat", system: "sys", messages: [{ role: "user", content: "hello" }] });
      // Nested contexts override only what they set.
      await withUsageContext({ agentId: "agent-2" }, () =>
        llm.generateObject({
          purpose: "intent",
          system: "sys",
          messages: [{ role: "user", content: "Arrange dinner with @marco" }],
          schema: z.object({ is_coordination: z.boolean() }).passthrough(),
          mockContext: { text: "Arrange dinner with @marco" },
        }),
      );
    });

    expect(records.map((r) => [r.purpose, r.taskId, r.agentId, r.userId, r.model, r.costUsd])).toEqual([
      ["owner_chat", "task-1", "agent-1", "user-1", "mock", 0],
      ["intent", "task-1", "agent-2", "user-1", "mock", 0],
    ]);
    expect(records.every((r) => r.inputTokens > 0 && r.outputTokens > 0)).toBe(true);
  });

  it("never lets a failing usage sink break the agent's reply", async () => {
    setUsageSinkForTesting(async () => {
      throw new Error("db down");
    });
    const text = await new MockProvider().generateText({ purpose: "owner_chat", system: "", messages: [{ role: "user", content: "hi" }] });
    expect(text).toContain("coordinate");
  });
});
