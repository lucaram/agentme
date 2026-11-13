import { describe, expect, it } from "vitest";
import { lookedUpNote, mockRoute } from "@/lib/research/answer";
import { mockResearch } from "@/lib/research/mock";

describe("↩ Reply and look-ups: the quoted message completes the question", () => {
  const quoted = "Anyone fancy a walk in Falkirk on Sunday?";

  it("whether it's a look-up is decided from the reply itself, never from the quote", () => {
    expect(mockRoute("sounds lovely, count me in", "What's the weather in Falkirk?").kind).toBe("chat");
    expect(mockRoute("what's the weather like?", quoted).kind).toBe("research");
  });

  it("the quote supplies the subject and the place the reply left out (test stand-in)", () => {
    const route = mockRoute("what's the weather like?", quoted);
    expect(route.question).toBe("what's the weather like? (about: Anyone fancy a walk in Falkirk on Sunday?)");
    expect(route.place).toBe("Falkirk");
    expect(mockResearch(route.question).text).toContain("In Falkirk it's 12°C");
  });

  it("a place named in the reply wins over one in the quote; no quote changes nothing", () => {
    expect(mockRoute("what's the weather in Leith?", quoted).place).toBe("Leith");
    expect(mockRoute("what's the weather in Leith?")).toEqual(mockRoute("what's the weather in Leith?", ""));
    expect(mockRoute("what's the weather in Leith?").question).toBe("what's the weather in Leith?");
  });

  it("only the start of a long quoted message is used", () => {
    const long = `Match report: ${"x".repeat(500)}`;
    expect(mockRoute("what was the score?", long).question.length).toBeLessThan(160);
  });

  it("the answer shows the question that actually went to the search", () => {
    expect(lookedUpNote("  Falkirk v Dundee score,\n 12 November ")).toBe("🔎 Looked up: Falkirk v Dundee score, 12 November");
    expect(lookedUpNote("q".repeat(400)).length).toBeLessThanOrEqual(215);
  });
});
