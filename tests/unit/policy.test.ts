import { describe, expect, it } from "vitest";
import { extractMentions, normalizeHandle, validateHandle } from "@/lib/policy/handles";
import { canContact } from "@/lib/policy/contactPolicy";
import { selectDisclosableFacts, type Fact } from "@/lib/policy/disclosure";

describe("handles", () => {
  it("normalises", () => {
    expect(normalizeHandle("  @Luca ")).toBe("luca");
  });
  it.each([
    ["luca", true],
    ["ab", false],
    ["a".repeat(21), false],
    ["luca-r", false],
    ["admin", false],
    ["LUCA_99", true],
  ])("validates %s", (input, ok) => {
    expect(validateHandle(input).ok).toBe(ok);
  });
  it("extracts distinct mentions, ignoring emails", () => {
    expect(extractMentions("Dinner with @Marco and @paul, cc @marco, mail luca@agentme.test")).toEqual(["marco", "paul"]);
  });
});

describe("contact policy", () => {
  it.each([
    ["contacts_only", "accepted", true],
    ["contacts_only", "pending", false],
    ["contacts_only", "none", false],
    ["anyone", "none", true],
    ["anyone", "blocked", false],
    ["nobody", "accepted", false],
  ] as const)("%s + %s -> %s", (policy, rel, allowed) => {
    expect(canContact(policy, rel).allowed).toBe(allowed);
  });
});

describe("disclosure", () => {
  const facts: Fact[] = [
    { category: "availability", value: "Sat after 7", disclosure: "contacts" },
    { category: "food", value: "Italian", disclosure: "private" },
    { category: "location", value: "Islington", disclosure: "contacts" },
    { category: "notes", value: "secret", disclosure: "contacts" },
  ];
  it("returns only shareable facts in requested categories, for accepted contacts", () => {
    expect(selectDisclosableFacts(facts, ["availability", "food"], "accepted").map((f) => f.category)).toEqual(["availability"]);
  });
  it("never returns notes even if marked shareable and requested", () => {
    expect(selectDisclosableFacts(facts, ["notes", "availability"], "accepted").map((f) => f.category)).toEqual(["availability"]);
  });
  it("returns nothing for non-contacts", () => {
    expect(selectDisclosableFacts(facts, ["availability", "location"], "none")).toEqual([]);
    expect(selectDisclosableFacts(facts, ["availability"], "pending")).toEqual([]);
    expect(selectDisclosableFacts(facts, ["availability"], "blocked")).toEqual([]);
  });
});
