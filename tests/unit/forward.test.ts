import { describe, expect, it } from "vitest";
import { MANY_TIMES, canForward, forwardLabel, forwardText, nextForward, placesAllowed } from "@/lib/social/forward";

const msg = (over: Partial<{ content: string; is_ai_generated: boolean; removed_at: string | null; metadata: unknown; senderHandle: string | null; system: boolean }> = {}) => ({
  content: "See you at 8",
  is_ai_generated: false,
  removed_at: null,
  metadata: {},
  senderHandle: null,
  system: false,
  ...over,
});

describe("↪ Forward: always a person's action, labelled", () => {
  it("messages can be forwarded; removed ones, app notes and plan cards can't", () => {
    expect(canForward(msg()).ok).toBe(true);
    expect(canForward(msg({ is_ai_generated: true, metadata: { kind: "business_answer", handle: "everyeye" } })).ok).toBe(true);
    expect(canForward(msg({ removed_at: "2026-11-09T10:00:00Z" })).ok).toBe(false);
    expect(canForward(msg({ system: true })).ok).toBe(false);
    for (const kind of ["task_card", "proposal", "poll", "business_suggestion", "fact_suggestion"]) expect(canForward(msg({ metadata: { kind } })).ok, kind).toBe(false);
  });

  it("a business's answer is forwarded without your agent's “I asked” heading", () => {
    const answer = msg({ is_ai_generated: true, senderHandle: "luca", content: "🏪 I asked @everyeye:\n\nWrite to nuovo_supporto@everyeye.it", metadata: { kind: "business_answer", handle: "everyeye" } });
    expect(forwardText(answer)).toBe("Write to nuovo_supporto@everyeye.it");
    expect(forwardText(msg())).toBe("See you at 8");
  });

  it("says which AI agent wrote the original; people's messages just say forwarded", () => {
    expect(nextForward(msg({ is_ai_generated: true, content: "🏪 I asked @everyeye: …", metadata: { kind: "business_answer", handle: "everyeye" } }))).toEqual({ count: 1, from_ai: "everyeye" });
    expect(nextForward(msg({ is_ai_generated: true, content: "👤 The team at Everyeye answered: yes", metadata: { kind: "business_answer", handle: "everyeye" } }))).toEqual({ count: 1, from_ai: null });
    expect(nextForward(msg({ is_ai_generated: true, senderHandle: "luca" }))).toEqual({ count: 1, from_ai: "luca" });
    expect(nextForward(msg())).toEqual({ count: 1, from_ai: null });
    // Forwarded again: one more, and the original AI stays named.
    expect(nextForward(msg({ metadata: { forwarded: { count: 2, from_ai: "everyeye" } } }))).toEqual({ count: 3, from_ai: "everyeye" });
  });

  it("up to 5 chats at once; once forwarded many times, 1 chat at a time", () => {
    expect(placesAllowed(msg())).toBe(5);
    expect(placesAllowed(msg({ metadata: { forwarded: { count: MANY_TIMES - 1, from_ai: null } } }))).toBe(5);
    expect(placesAllowed(msg({ metadata: { forwarded: { count: MANY_TIMES, from_ai: null } } }))).toBe(1);
  });

  it("the label people see", () => {
    expect(forwardLabel({ count: 1, from_ai: "everyeye" })).toBe("↪ Forwarded · from @everyeye's agent");
    expect(forwardLabel({ count: 2, from_ai: null })).toBe("↪ Forwarded");
    expect(forwardLabel({ count: MANY_TIMES, from_ai: null })).toBe("↪↪ Forwarded many times");
  });
});
