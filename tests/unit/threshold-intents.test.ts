import { describe, expect, it } from "vitest";
import { describeTransition, evaluate } from "@/lib/plans/threshold";
import { heuristicIntent, splitList } from "@/lib/coordination/heuristics";

const a = (handle: string, response: "in" | "out", at: string) => ({ handle, response, at });

describe("threshold: minimum, maximum and waitlist (code, not AI)", () => {
  it("fills places in the order people said yes; the rest wait in order", () => {
    const s = evaluate([a("eve", "in", "3"), a("luca", "in", "1"), a("paul", "out", "2"), a("marco", "in", "2")], { max: 2 });
    expect(s).toEqual({ going: ["luca", "marco"], waitlist: ["eve"], out: ["paul"], on: true });
  });

  it("is on only once the minimum is reached", () => {
    expect(evaluate([a("luca", "in", "1")], { min: 2 }).on).toBe(false);
    expect(evaluate([a("luca", "in", "1"), a("marco", "in", "2")], { min: 2 }).on).toBe(true);
  });

  it("announces joining the waitlist, moving up, and the plan going on/off", () => {
    const names = new Map([["eve", "Eve"], ["marco", "Marco"]]);
    const cfg = { min: 2, max: 2 };
    const s1 = evaluate([a("luca", "in", "1")], cfg);
    const s2 = evaluate([a("luca", "in", "1"), a("marco", "in", "2")], cfg);
    expect(describeTransition(s1, s2, cfg, { handle: "marco", name: "Marco", changed: false }, names)).toEqual([
      "Marco is in ✅",
      "It's on! ✅ 2 of 2 needed are in.",
    ]);
    const s3 = evaluate([a("luca", "in", "1"), a("marco", "in", "2"), a("eve", "in", "3")], cfg);
    expect(describeTransition(s2, s3, cfg, { handle: "eve", name: "Eve", changed: false }, names)).toEqual([
      "Eve is on the waitlist (#1) — the plan is full (2 max).",
    ]);
    const s4 = evaluate([a("luca", "in", "1"), a("marco", "out", "4"), a("eve", "in", "3")], cfg);
    expect(describeTransition(s3, s4, cfg, { handle: "marco", name: "Marco", changed: true }, names)).toEqual([
      "Marco changed their answer: can't make it ❌",
      "Eve moved up from the waitlist: is in ✅",
    ]);
  });

  it("warns when the plan drops below the minimum", () => {
    const cfg = { min: 2 };
    const on = evaluate([a("luca", "in", "1"), a("marco", "in", "2")], cfg);
    const off = evaluate([a("luca", "in", "1"), a("marco", "out", "3")], cfg);
    expect(describeTransition(on, off, cfg, { handle: "marco", name: "Marco", changed: true }, new Map())).toContain(
      "Not enough people anymore: 1 of 2 needed.",
    );
  });
});

describe("intents for Milestone 3", () => {
  it("a fixed day and time is an invitation, with limits", () => {
    expect(heuristicIntent("Organise five-a-side on Thursday at 7pm with @marco @paul @eve, need 4")).toMatchObject({
      kind: "rsvp",
      event: "Five-a-side",
      window: "Thursday",
      time: "19:00",
      min: 4,
      max: 0,
      participants: ["marco", "paul", "eve"],
    });
    expect(heuristicIntent("Invite @marco and @paul to drinks on Friday at 8:30pm, max 2")).toMatchObject({ kind: "rsvp", time: "20:30", max: 2 });
    // Without a fixed time it's still "find a time" coordination.
    expect(heuristicIntent("Arrange dinner with @marco on Saturday evening").kind).toBe("coordinate");
  });

  it("recognises sign-up lists and keeps the items exactly", () => {
    expect(heuristicIntent("Ask @marco and @paul who brings what for Saturday: drinks, dessert and bread")).toMatchObject({
      kind: "assign",
      items: ["drinks", "dessert", "bread"],
    });
    expect(splitList("ball, bibs; water")).toEqual(["ball", "bibs", "water"]);
  });

  it("recognises announcements and keeps the exact words", () => {
    expect(heuristicIntent("Tell @marco and @paul: the trip is tomorrow, bring lunch")).toMatchObject({
      kind: "announce",
      message: "the trip is tomorrow, bring lunch",
    });
    expect(heuristicIntent("Let @marco know that I'm running 10 minutes late").message).toBe("I'm running 10 minutes late");
  });
});
