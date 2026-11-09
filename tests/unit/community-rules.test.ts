import { describe, expect, it } from "vitest";
import { cleanRules, houseRuleBlock, houseRuleLabel, rulesList, rulesText } from "@/lib/social/rules";
import { decide } from "@/lib/social/moderation";

describe("community rules: 3 core rules + up to 5 picked house rules", () => {
  it("the core rules are always there, then the picked house rules", () => {
    expect(rulesList(["no_spoilers"]).map((r) => r.label)).toEqual(["Be respectful", "No spam or selling", "Stay on topic", "No spoilers"]);
    expect(rulesText([], null)).toBe("Be respectful.\nNo spam or selling.\nStay on topic.");
  });

  it("only known rules, at most five; a language rule needs a language", () => {
    expect(cleanRules({ houseRules: ["no_spoilers", "made_up", "no_spoilers"] })).toEqual({ ok: true, houseRules: ["no_spoilers"], language: null });
    expect(cleanRules({ houseRules: ["no_spoilers", "no_links", "no_media", "no_politics", "no_religion", "no_chain"] })).toMatchObject({ ok: false, error: expect.stringContaining("up to 5") });
    expect(cleanRules({ houseRules: ["language_only"] })).toMatchObject({ ok: false });
    expect(cleanRules({ houseRules: ["language_only"], language: "mixed" })).toMatchObject({ ok: false });
    expect(cleanRules({ houseRules: ["language_only"], language: "it" })).toEqual({ ok: true, houseRules: ["language_only"], language: "it" });
    expect(houseRuleLabel("language_only", "it")).toBe("Italian only");
    expect(cleanRules({ language: "klingon" })).toEqual({ ok: true, houseRules: [], language: null });
  });

  it("No links / No images or videos are checked in code", () => {
    expect(houseRuleBlock("see https://x.example", ["no_links"], 1)).toContain("doesn't allow links");
    expect(houseRuleBlock("look https://cdn.example/goal.mp4", ["no_media"], 1)).toContain("images or videos");
    expect(houseRuleBlock("https://youtu.be/abc", ["no_media"], 1)).toContain("images or videos");
    expect(houseRuleBlock("great match", ["no_links", "no_media"], 0)).toBeNull();
  });

  it("a house rule can only nudge, never refuse", () => {
    expect(decide({ verdict: "house_rule", confidence: 0.99, reason: "Spoiler.", rule: "No spoilers" })).toMatchObject({ action: "nudge", rule: "No spoilers" });
    expect(decide({ verdict: "house_rule", confidence: 0.3, reason: "", rule: "No spoilers" })).toEqual({ action: "post" });
  });
});
