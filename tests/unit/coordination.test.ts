import { describe, expect, it } from "vitest";
import {
  commonCuisine,
  heuristicIntent,
  heuristicPlan,
  parseAvailability,
  parseClock,
  relevantClause,
} from "@/lib/coordination/heuristics";
import { validateProposal } from "@/lib/coordination/validate";

describe("clock & availability parsing", () => {
  it.each([
    ["7 PM", 19 * 60],
    ["7:30pm", 19 * 60 + 30],
    ["19:00", 19 * 60],
    ["12am", 0],
    ["7", 19 * 60],
  ])("parseClock(%s)", (input, minutes) => expect(parseClock(input)).toBe(minutes));

  it("parses after/before/ranges/unavailable", () => {
    expect(parseAvailability("Saturdays after 7 PM")).toEqual({ unavailable: false, earliest: 19 * 60 });
    expect(parseAvailability("free until 10pm")).toEqual({ unavailable: false, latest: 22 * 60 });
    expect(parseAvailability("6-9pm")).toEqual({ unavailable: false, earliest: 18 * 60, latest: 21 * 60 });
    expect(parseAvailability("Not available this weekend").unavailable).toBe(true);
  });

  it("picks the clause for the requested day", () => {
    expect(relevantClause("Weekday evenings after 6:30 PM; Saturdays after 6 PM", "Saturday evening")).toBe("Saturdays after 6 PM");
  });
});

describe("intent", () => {
  it("parses the canonical dinner request", () => {
    expect(heuristicIntent("Arrange dinner with @marco and @paul on Saturday evening.")).toEqual({
      kind: "coordinate",
      event: "dinner",
      window: "Saturday evening",
      participants: ["marco", "paul"],
      categories: ["availability", "food"],
      question: "",
      options: [],
    });
  });
  it("is just chat without mentions", () => {
    expect(heuristicIntent("What can you do?").kind).toBe("chat");
  });
  it("recognises polls and keeps the options exactly", () => {
    expect(heuristicIntent("Ask @marco and @paul to vote: Italian, Thai or Indian")).toMatchObject({
      kind: "poll",
      participants: ["marco", "paul"],
      options: ["Italian", "Thai", "Indian"],
    });
    expect(heuristicIntent("Ask @marco and @paul which day works better, Saturday or Sunday?")).toMatchObject({
      kind: "poll",
      question: "Which day works better?",
      options: ["Saturday", "Sunday"],
    });
  });
  it("recognises questions and addresses them to the recipient", () => {
    expect(heuristicIntent("Ask @marco if he can help me move on Sunday")).toMatchObject({
      kind: "question",
      participants: ["marco"],
      question: "Can you help me move on Sunday?",
    });
    expect(heuristicIntent("Ask @paul: do you still have my drill?").question).toBe("Do you still have my drill?");
    // "ask ... to arrange" is coordination, not a question
    expect(heuristicIntent("Ask @marco to arrange dinner on Friday").kind).toBe("coordinate");
  });
});

describe("planning & validation", () => {
  const replies = [
    { handle: "luca", availability: "Saturdays after 6 PM", food: "Loves Italian and Japanese" },
    { handle: "marco", availability: "Saturdays after 7 PM", food: "Italian, no seafood" },
    { handle: "paul", availability: "Saturdays after 6 PM", food: "Italian or Thai" },
  ];

  it("produces the expected dinner plan", () => {
    const plan = heuristicPlan("luca", replies, "dinner", "Saturday evening");
    expect(plan).toMatchObject({ day: "Saturday", time: "19:30", cuisine: "Italian", participants: ["luca", "marco", "paul"] });
    expect(validateProposal(plan, "luca", replies)).toEqual({ ok: true });
  });

  it("rejects a time before someone is available", () => {
    const result = validateProposal(
      { title: "Dinner", day: "Saturday", time: "18:30", cuisine: null, participants: ["luca", "marco", "paul"], rationale: "" },
      "luca",
      replies,
    );
    expect(result).toEqual({ ok: false, problems: ["@marco is only available later."] });
  });

  it("rejects participants who were not asked or said no", () => {
    const withNo = [...replies, { handle: "eve", availability: "busy", food: null }];
    const result = validateProposal(
      { title: "Dinner", day: "Saturday", time: "19:30", cuisine: null, participants: ["luca", "eve", "mallory"], rationale: "" },
      "luca",
      withNo,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems).toEqual(["@eve said they are not available.", "@mallory was not part of the coordination."]);
  });

  it("finds a common cuisine", () => {
    expect(commonCuisine(["Thai please", "thai or indian", "Indian"])).toBe("Thai");
    expect(commonCuisine([null, "anything"])).toBeNull();
  });
});
