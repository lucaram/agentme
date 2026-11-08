import { describe, expect, it } from "vitest";
import { matchTips, parseAskAround } from "@/lib/people/askAround";

describe("ask around: recognising the request", () => {
  it("explicit and natural phrasings", () => {
    expect(parseAskAround("ask around: does anyone know a good plumber in Camden?")).toEqual({ question: "Does anyone know a good plumber in Camden?", mentions: [] });
    expect(parseAskAround("Can anyone recommend a hotel in Lisbon")).toEqual({ question: "Can anyone recommend a hotel in Lisbon?", mentions: [] });
    expect(parseAskAround("Any recommendations for a babysitter?")?.question).toBe("Any recommendations for a babysitter?");
    expect(parseAskAround("who can lend me a drill this weekend?")?.question).toBe("Who can lend me a drill this weekend?");
  });

  it("@mentions narrow it to those people", () => {
    expect(parseAskAround("ask around @marco @paul: best pizza near Camden?")).toEqual({ question: "Best pizza near Camden?", mentions: ["marco", "paul"] });
  });

  it("other requests are left alone", () => {
    expect(parseAskAround("Arrange dinner with @marco on Saturday")).toBeNull();
    expect(parseAskAround("Ask @marco if he can help me move")).toBeNull();
    expect(parseAskAround("What did we decide?")).toBeNull();
  });
});

describe("ask around: saved tips", () => {
  const tips = [
    { topic: "plumber", tip: "Joe's Plumbing, 020 7946 0000" },
    { topic: "Italian restaurants in Camden", tip: "Trattoria Sole" },
    { topic: "dentist", tip: "Dr Smith on Camden Road" },
  ];
  it("match by topic words, forgiving plurals and -ing", () => {
    expect(matchTips("Does anyone know a good plumbing firm?", tips).map((t) => t.topic)).toEqual(["plumber"]);
    expect(matchTips("Best Italian place?", tips).map((t) => t.topic)).toEqual(["Italian restaurants in Camden"]);
    expect(matchTips("Who can lend me a drill?", tips)).toEqual([]);
  });
});
