import { describe, expect, it } from "vitest";
import { canQuote, quoteContext, quoteSnippet, withReplyContext } from "@/lib/social/quote";

const msg = (over: Partial<Parameters<typeof canQuote>[0]> = {}) => ({ sender_user_id: "u1", sender_agent_id: null, removed_at: null, visible_to: null, metadata: {}, content: "Pitch is booked for 7pm", ...over });

describe("↩ Reply: what can be quoted", () => {
  it("messages from people and agents that everyone in the chat can see", () => {
    expect(canQuote(msg())).toBe(true);
    expect(canQuote(msg({ sender_user_id: null, sender_agent_id: "a1" }))).toBe(true);
    expect(canQuote(msg({ metadata: { kind: "task_card" } }))).toBe(true); // "re: the plan"
  });

  it("not private @agent messages, removed ones, app notes, or empty ones", () => {
    expect(canQuote(msg({ visible_to: "u1" }))).toBe(false);
    expect(canQuote(msg({ removed_at: "2026-11-09T10:00:00Z" }))).toBe(false);
    expect(canQuote(msg({ sender_user_id: null, sender_agent_id: null }))).toBe(false);
    expect(canQuote(msg({ metadata: { kind: "agent_command" } }))).toBe(false);
    expect(canQuote(msg({ content: "   " }))).toBe(false);
  });

  it("a short, one-line preview", () => {
    expect(quoteSnippet("Line one\n\nline   two")).toBe("Line one line two");
    expect(quoteSnippet("x".repeat(200), 10)).toBe(`${"x".repeat(9)}…`);
  });

  it("agents are told what the message replies to", () => {
    const ctx = quoteContext("@trattoria's agent", "Yes, about half the menu is vegetarian.");
    expect(ctx).toBe("@trattoria's agent: Yes, about half the menu is vegetarian.");
    expect(withReplyContext("@trattoria and on Sundays?", ctx)).toBe("@trattoria and on Sundays?\n\n(Replying to — @trattoria's agent: Yes, about half the menu is vegetarian.)");
    expect(withReplyContext("hi")).toBe("hi");
  });
});
