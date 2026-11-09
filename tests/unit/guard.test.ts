import { describe, expect, it } from "vitest";
import { checkCommunityMessage, countLinks, countMentions, sameMessage, trustLevel } from "@/lib/social/guard";

const now = Date.parse("2026-11-09T12:00:00Z");
const ago = (hours: number) => new Date(now - hours * 3_600_000).toISOString();

describe("community trust levels", () => {
  it("moderators are exempt; new, member and trusted follow time and messages", () => {
    expect(trustLevel({ role: "moderator", joinedAt: ago(1), messages: 0, removedRecently: 0, now })).toBe("moderator");
    expect(trustLevel({ role: "owner", joinedAt: ago(1), messages: 0, removedRecently: 0, now })).toBe("moderator");
    expect(trustLevel({ role: "member", joinedAt: ago(2), messages: 10, removedRecently: 0, now })).toBe("new"); // under a day
    expect(trustLevel({ role: "member", joinedAt: ago(48), messages: 1, removedRecently: 0, now })).toBe("new"); // few messages
    expect(trustLevel({ role: "member", joinedAt: ago(48), messages: 5, removedRecently: 0, now })).toBe("member");
    expect(trustLevel({ role: "member", joinedAt: ago(24 * 8), messages: 25, removedRecently: 0, now })).toBe("trusted");
    expect(trustLevel({ role: "member", joinedAt: ago(24 * 8), messages: 25, removedRecently: 1, now })).toBe("new"); // a removed message
  });
});

describe("community spam checks", () => {
  it("counts links and mentions", () => {
    expect(countLinks("see https://a.example/x and www.b.com and shop.io/deal")).toBe(3);
    expect(countLinks("no links, just 3.5 goals")).toBe(0);
    expect(countMentions("@marco @paul and email me at a@b.com")).toBe(2);
  });

  it("new members can't post links; others have a limit", () => {
    expect(checkCommunityMessage("Great match! https://clip.example/goal", "new", [])).toMatchObject({ ok: false, error: expect.stringContaining("New members") });
    expect(checkCommunityMessage("Great match! https://clip.example/goal", "member", [])).toEqual({ ok: true, flags: [] });
    expect(checkCommunityMessage("a.com b.com c.com d.com", "member", [])).toMatchObject({ ok: false, error: expect.stringContaining("up to 3") });
    expect(checkCommunityMessage("a.com b.com c.com d.com", "trusted", [])).toEqual({ ok: true, flags: [] });
    expect(checkCommunityMessage("a.com b.com c.com d.com e.com f.com", "moderator", [])).toEqual({ ok: true, flags: [] });
  });

  it("blocks mention floods and repeats; flags selling without blocking it", () => {
    expect(checkCommunityMessage("@aaa @bbb @ccc @ddd @eee @fff look", "trusted", [])).toMatchObject({ ok: false, error: expect.stringContaining("at most 5") });
    expect(checkCommunityMessage("Who's coming Saturday?", "member", ["who's coming saturday"])).toMatchObject({ ok: false, error: expect.stringContaining("just posted") });
    expect(sameMessage("Hi!!", "hi")).toBe(true);
    expect(checkCommunityMessage("Season tickets for sale, £40 each", "member", [])).toEqual({ ok: true, flags: ["selling"] });
    expect(checkCommunityMessage("What a goal on Saturday", "new", [])).toEqual({ ok: true, flags: [] });
  });
});
