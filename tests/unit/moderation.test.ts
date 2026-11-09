import { describe, expect, it } from "vitest";
import { agreesWithReports, decide, mockModeration, type Moderation } from "@/lib/social/moderation";

const m = (verdict: Moderation["verdict"], confidence: number, reason = "Because.") => ({ verdict, confidence, reason });

describe("community autopilot: code decides what happens", () => {
  it("refuses only near-certain spam and clear abuse", () => {
    expect(decide(m("spam", 0.95))).toMatchObject({ action: "refuse", message: expect.stringContaining("looks like spam") });
    expect(decide(m("abusive", 0.9))).toMatchObject({ action: "refuse", rule: "Be respectful" });
    expect(decide(m("spam", 0.8))).toMatchObject({ action: "nudge", rule: "No spam or selling" }); // not sure enough to refuse
  });

  it("nudges for disrespect, selling and off-topic; posts when unsure or fine", () => {
    expect(decide(m("disrespectful", 0.8))).toMatchObject({ action: "nudge", rule: "Be respectful", message: expect.stringContaining("Because.") });
    expect(decide(m("selling", 0.7))).toMatchObject({ action: "nudge", rule: "No spam or selling" });
    expect(decide(m("off_topic", 0.65))).toMatchObject({ action: "nudge", rule: "Stay on topic" });
    expect(decide(m("off_topic", 0.4))).toEqual({ action: "post" });
    expect(decide(m("ok", 0.99))).toEqual({ action: "post" });
  });

  it("hides after reports only when the check agrees", () => {
    expect(agreesWithReports(m("disrespectful", 0.75))).toBe(true);
    expect(agreesWithReports(m("disrespectful", 0.5))).toBe(false);
    expect(agreesWithReports(m("ok", 0.9))).toBe(false);
  });

  it("the stand-in model is predictable for tests", () => {
    expect(mockModeration("You're an idiot")).toMatchObject({ verdict: "disrespectful" });
    expect(mockModeration("Click here for free money")).toMatchObject({ verdict: "spam", confidence: 0.95 });
    expect(mockModeration("I hate you")).toMatchObject({ verdict: "abusive" });
    expect(mockModeration("What a goal on Saturday!")).toMatchObject({ verdict: "ok" });
  });
});
