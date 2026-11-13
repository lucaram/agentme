import { describe, expect, it } from "vitest";
import { MAX_MESSAGES_SHOWN, MESSAGES_PER_PAGE, shownCount } from "@/lib/social/paging";

describe("how many messages a chat shows", () => {
  it("the latest 200, and 200 more for each 'Show earlier messages'", () => {
    expect(shownCount(undefined)).toBe(MESSAGES_PER_PAGE);
    expect(shownCount("1")).toBe(400);
    expect(shownCount("3")).toBe(800);
  });

  it("never more than 2,000, whatever the address says", () => {
    expect(shownCount("9")).toBe(MAX_MESSAGES_SHOWN);
    expect(shownCount("999")).toBe(MAX_MESSAGES_SHOWN);
    for (const bad of ["-1", "1.5", "abc", "1e9", "", ["1"], 5, null]) expect(shownCount(bad)).toBe(MESSAGES_PER_PAGE);
  });
});
