import { describe, expect, it } from "vitest";
import { describeResult, suggestVote, tally } from "@/lib/plans/poll";
import { describeRecall, type RecallPlan } from "@/lib/agents/recall-format";

describe("poll counting (code, not AI)", () => {
  it("counts votes, ignores invalid ones and finds the winner", () => {
    const r = tally(["Italian", "Thai", "Indian"], ["Italian", "Thai", "Italian", "Pizza"], 4);
    expect(r).toEqual({ counts: { Italian: 2, Thai: 1, Indian: 0 }, winners: ["Italian"], votes: 3, voters: 4 });
    expect(describeResult("Where?", r)).toBe("Poll closed: “Where?” — Italian (2 of 3 votes).");
  });

  it("reports ties and empty polls", () => {
    expect(describeResult("Day?", tally(["Sat", "Sun"], ["Sat", "Sun"], 2))).toBe("Poll closed: “Day?” — tie between Sat and Sun (1 of 2 votes each).");
    expect(describeResult("Day?", tally(["Sat", "Sun"], [], 2))).toBe("Poll closed: “Day?” — no votes.");
  });
});

describe("vote suggestions (agent suggests, human decides)", () => {
  it("suggests the one option matching the voter's own preferences", () => {
    expect(suggestVote(["Italian", "Thai", "Indian"], [{ category: "food", value: "Italian, no seafood" }])).toEqual({
      option: "Italian",
      because: "your food preferences",
    });
  });

  it("never suggests something the preference rules out, or when it's ambiguous", () => {
    expect(suggestVote(["Seafood", "Pizza"], [{ category: "food", value: "Italian, no seafood" }])).toBeNull();
    expect(suggestVote(["Italian", "Thai"], [{ category: "food", value: "Italian or Thai" }])).toBeNull();
  });

  it("ignores private notes entirely", () => {
    expect(suggestVote(["Italian", "Thai"], [{ category: "notes", value: "I secretly love Thai" }])).toBeNull();
  });
});

describe("recall", () => {
  const plans: RecallPlan[] = [
    {
      kind: "coordinate",
      title: "Dinner — Italian",
      organiser: "luca",
      status: "accepted",
      createdAt: "",
      when: "Saturday at 7:30 PM",
      rsvp: { in: ["luca", "marco"], out: [], waiting: ["paul"] },
    },
  ];

  it("answers from the owner's own plans", () => {
    expect(describeRecall("What time did we agree for dinner?", plans)).toBe(
      "Dinner — Italian is on Saturday at 7:30 PM. @luca and @marco are in. We're still waiting for @paul to reply.",
    );
  });

  it("says so when there's nothing to recall", () => {
    expect(describeRecall("anything?", [])).toBe("You don't have any plans yet.");
  });

  it("uses the viewer's identity and real names, without empty attendance categories", () => {
    const plan: RecallPlan = { ...plans[0], event: "dinner", venue: { agent_id: "venue", handle: "trattoria", name: "Trattoria Sole" }, reservationWays: [{ kind: "call", value: "020 7946 0000" }], names: { luca: "Luca", marco: "Marco", paul: "Paul" }, rsvp: { in: ["luca", "marco", "paul"], out: [], waiting: [] } };
    expect(describeRecall("Who's coming?", [plan], "luca")).toBe("Your dinner at Trattoria Sole is on Saturday at 7:30 PM. You, Marco and Paul are all in.\n\nAGENTME hasn't made a reservation. To arrange one, use the options below.");
    expect(describeRecall("Who's coming?", [plan], "marco")).toContain("You, Luca and Paul are all in.");
    expect(describeRecall("Has everyone replied?", [plan], "luca")).toContain("Everyone has replied.");
  });

  it("mentions real declines, pending replies and waitlists with correct grammar", () => {
    const plan: RecallPlan = { ...plans[0], names: { luca: "Luca", marco: "Marco", paul: "Paul" }, rsvp: { in: ["marco"], out: ["paul"], waiting: ["luca"] } };
    expect(describeRecall("Who's coming?", [plan], "luca")).toBe("Dinner — Italian is on Saturday at 7:30 PM. Marco is in. Paul can't make it. We're still waiting for you to reply.");
    const waitlisted = { ...plan, rsvp: { in: [], out: ["paul"], waiting: [], waitlist: ["luca"] } };
    const answer = describeRecall("Who's coming?", [waitlisted], "luca");
    expect(answer).toContain("No one has confirmed yet. Paul can't make it. You are on the waitlist.");
    expect(answer).not.toContain("all in");
  });
});

describe("recall through My Agent (mock model)", () => {
  it("answers questions about plans from the recall data, and chats otherwise", async () => {
    const { MockProvider } = await import("@/lib/llm/mock");
    const plans: RecallPlan[] = [
      { kind: "coordinate", title: "Dinner — Italian", organiser: "luca", status: "accepted", createdAt: "", when: "Saturday at 7:30 PM", rsvp: { in: ["luca"], out: [], waiting: [] } },
    ];
    const ask = (text: string) =>
      new MockProvider().generateText({ purpose: "owner_chat", system: "", messages: [{ role: "user", content: text }], mockContext: { text, recall: plans } });
    expect(await ask("What time did we agree for dinner?")).toMatch(/^Dinner — Italian is on Saturday at 7:30 PM\./);
    expect(await ask("Who hasn't replied?")).toContain("Everyone has replied.");
    expect(await ask("Hello there")).toMatch(/^I can coordinate plans/);
  });
});
