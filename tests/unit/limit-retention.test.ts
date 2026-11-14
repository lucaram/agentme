import { afterEach, expect, it, vi } from "vitest";
const { lt } = vi.hoisted(() => ({ lt: vi.fn(async () => ({ error: null })) }));
vi.mock("@/lib/supabase/admin", () => ({ adminClient: () => ({ from: () => ({ delete: () => ({ lt }) }) }) }));
import { pruneRateLimits } from "@/lib/limits";

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
it("the afternoon sweep preserves active daily counters while pruning expired daily windows", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-14T15:00:00Z"));
  await pruneRateLimits();
  const [column, before] = lt.mock.calls[0] as unknown as [string, string];
  expect(column).toBe("window_start");
  const cutoff = Date.parse(before);
  expect(Date.parse("2026-11-14T00:00:00Z")).toBeGreaterThan(cutoff);
  expect(Date.parse("2026-11-13T00:00:00Z")).toBeLessThan(cutoff);
});
