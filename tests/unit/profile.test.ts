import { describe, expect, it } from "vitest";
import { parseUntil, suggestFact } from "@/lib/profile/suggest";
import { addChip, cleanLabel } from "@/lib/profile/topics";
import { factsByRequest, selectDisclosableFacts, type Fact } from "@/lib/policy/disclosure";

const today = new Date("2026-11-09T10:00:00Z");

describe("what your agent knows: sharing rules", () => {
  const facts: Fact[] = [
    { category: "availability", value: "Weekday evenings", disclosure: "contacts" },
    { category: "away", value: "Away until 20 Dec", disclosure: "contacts" },
    { category: "interests", value: "Climbing", disclosure: "contacts" },
    { category: "custom", label: "Music I like", value: "Jazz", disclosure: "contacts" },
    { category: "custom", label: "Secret", value: "Hidden", disclosure: "private" },
    { category: "budget", value: "££", disclosure: "private" },
    { category: "practical", value: "Step-free access", disclosure: "contacts" },
    { category: "notes", value: "Never", disclosure: "contacts" as never },
  ];

  it("time away goes with availability; your own topics go with interests", () => {
    const got = selectDisclosableFacts(facts, ["availability", "interests"], "accepted");
    expect(factsByRequest(got)).toEqual({ availability: "Weekday evenings; Away until 20 Dec", interests: "Climbing; Music I like: Jazz" });
  });

  it("only shared items, only the topics asked for, only for contacts; notes never", () => {
    expect(selectDisclosableFacts(facts, ["budget", "practical", "notes"], "accepted").map((f) => f.value)).toEqual(["Step-free access"]);
    expect(selectDisclosableFacts(facts, ["availability", "interests", "practical"], "none")).toEqual([]);
  });
});

describe("quick picks and names", () => {
  it("adds a chip once", () => {
    expect(addChip("", "Climbing")).toBe("Climbing");
    expect(addChip("Cinema", "Climbing")).toBe("Cinema, Climbing");
    expect(addChip("Cinema, climbing", "Climbing")).toBe("Cinema, climbing");
  });
  it("tidies your own topic names", () => {
    expect(cleanLabel("  music   i like ")).toBe("Music i like");
  });
});

describe("“Save to your profile?” suggestions", () => {
  it("understands dates", () => {
    expect(parseUntil("20 Dec", today)).toBe("2026-12-20");
    expect(parseUntil("december 20th", today)).toBe("2026-12-20");
    expect(parseUntil("3 Jan", today)).toBe("2027-01-03");
    expect(parseUntil("31 feb", today)).toBeNull();
  });

  it.each([
    ["I'm vegetarian now", { category: "food", value: "vegetarian" }],
    ["I am now vegan", { category: "food", value: "vegan" }],
    ["I'm away until 20 Dec", { category: "away", until: "2026-12-20" }],
    ["I'll be on holiday till January 3rd", { category: "away", until: "2027-01-03" }],
    ["I love climbing", { category: "interests", value: "climbing" }],
    ["My hobbies are cinema and board games", { category: "interests", value: "cinema and board games" }],
    ["I live in Camden", { category: "location", value: "Camden" }],
    ["I don't drink", { category: "practical", value: "Doesn't drink alcohol" }],
    ["I'm allergic to peanuts", { category: "practical", value: "Allergic to peanuts" }],
    ["I have a dog", { category: "practical", value: "Has a dog" }],
  ])("%s", (text, expected) => {
    expect(suggestFact(text, today)).toMatchObject(expected);
  });

  it.each(["Arrange dinner with @marco on Saturday", "Do you love climbing?", "I love you", "What time did we agree?", "I'm away"])("offers nothing for: %s", (text) => {
    expect(suggestFact(text, today)).toBeNull();
  });
});

describe("changing your avatar", () => {
  it("people pick from the personal set, businesses from the business set", async () => {
    const { AVATARS, BUSINESS_AVATARS, avatarsFor } = await import("@/lib/avatars");
    expect(avatarsFor("personal", "🦊")).toEqual(AVATARS);
    expect(avatarsFor("business", "🏪")).toEqual(BUSINESS_AVATARS);
  });

  it("keeps the current avatar as a choice when it isn't in the set", async () => {
    const { BUSINESS_AVATARS, avatarsFor } = await import("@/lib/avatars");
    expect(avatarsFor("business", "🦊")).toEqual(["🦊", ...BUSINESS_AVATARS]);
  });
});
