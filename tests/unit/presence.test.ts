import { describe, expect, it } from "vitest";
import { aggregatePresence, automaticState, IDLE_MS, presenceLabel } from "@/lib/presence/types";

describe("presence semantics", () => {
  it("does not treat a background or idle app as online", () => {
    expect(automaticState("auto", true, 0, IDLE_MS - 1)).toBe("online");
    expect(automaticState("auto", true, 0, IDLE_MS)).toBe("away");
    expect(automaticState("auto", false, 100, 100)).toBe("away");
  });
  it("honours explicit availability without changing notification or read status", () => {
    expect(automaticState("busy", false, 0, IDLE_MS)).toBe("busy");
    expect(automaticState("away", true, 100, 100)).toBe("away");
    expect(automaticState("invisible", true, 100, 100)).toBe("offline");
  });
  it("counts every active tab/device, ignores malformed payloads and does not confuse a viewer with a publisher", () => {
    expect(aggregatePresence([])).toBe("offline");
    expect(aggregatePresence([{ state: "away" }, { state: "online" }])).toBe("online");
    expect(aggregatePresence([{ state: "away" }, { state: "busy" }])).toBe("busy");
    expect(aggregatePresence([{ state: "away" }])).toBe("away");
    expect(aggregatePresence([{ online: true }, { state: "offline" }, null])).toBe("offline");
  });
  it("always names business staff explicitly", () => {
    expect(presenceLabel("online", true)).toBe("Team online");
    expect(presenceLabel("offline", true)).toBe("Team offline");
    expect(presenceLabel("busy", false)).toBe("Busy");
  });
});
