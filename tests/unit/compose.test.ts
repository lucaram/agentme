import { describe, expect, it } from "vitest";
import { draftFromSteps, emptyStep, heuristicCompose, validateDraft, type PlanDraft } from "@/lib/plans/compose";

const ctx = { organiser: "luca", participants: ["marco", "paul"] };
const plan = (...steps: PlanDraft["steps"]): PlanDraft => ({ kind: "plan", title: "Test", steps });
const types = (d: PlanDraft) => {
  const v = validateDraft(d, ctx);
  return v.ok ? v.steps.map((s) => s.type) : v.error;
};

describe("composer: any request becomes blocks", () => {
  it("composes the templates", () => {
    expect(heuristicCompose("Arrange dinner with @marco and @paul on Saturday evening").steps.map((s) => s.type)).toEqual(["collect"]);
    expect(heuristicCompose("Organise five-a-side on Thursday at 7pm with @marco and @paul, need 3, someone bring a ball and bibs").steps).toMatchObject([
      { type: "rsvp", event: "Five-a-side", window: "Thursday", time: "19:00", min: 3 },
      { type: "assign", items: ["ball", "bibs"] },
    ]);
    expect(heuristicCompose("Ask @marco and @paul who drives which day: Monday, Tuesday, Wednesday").steps).toMatchObject([
      { type: "assign", items: ["Monday", "Tuesday", "Wednesday"] },
    ]);
    expect(heuristicCompose("Plan a meeting with @marco and @paul and collect agenda items").steps.map((s) => s.type)).toEqual(["collect", "question"]);
    expect(heuristicCompose("Thoughts on pizza, @marco?").kind).toBe("chat");
  });
});

describe("composer: code validates every composition", () => {
  it("adds the proposal and who's-in after finding a time, in a sensible order", () => {
    expect(types(plan({ ...emptyStep("collect"), window: "Saturday" }))).toEqual(["collect", "proposal", "rsvp"]);
    expect(types(plan({ ...emptyStep("collect"), window: "Mon" }, { ...emptyStep("question"), question: "Agenda?" }))).toEqual([
      "collect",
      "question",
      "proposal",
      "rsvp",
    ]);
  });

  it("rejects compositions that don't make sense", () => {
    expect(types(plan(emptyStep("proposal")))).toMatch(/needs the agents' availability first/);
    expect(types(plan({ ...emptyStep("poll"), question: "Q", options: ["A", "B"] }, { ...emptyStep("poll"), question: "Q2", options: ["C", "D"] }))).toMatch(/only once/);
    expect(types(plan({ ...emptyStep("rsvp"), window: "Thursday" }))).toMatch(/fixed day and time/);
    expect(types(plan({ ...emptyStep("poll"), question: "Q", options: ["only one"] }))).toMatch(/at least two options/);
    expect(types(plan({ ...emptyStep("rsvp"), window: "Thu", time: "19:00", min: 9 }))).toMatch(/at least 9 people but invited 3/);
    expect(types(plan(emptyStep("assign")))).toMatch(/at least one item/);
    expect(types(plan())).toMatch(/no steps/);
    expect(types(plan(...Array.from({ length: 6 }, () => emptyStep("announce"))))).toMatch(/at most 5 steps/);
  });

  it("people come from the owner's mentions only, never from the model", () => {
    const v = validateDraft(plan({ ...emptyStep("poll"), question: "Q?", options: ["A", "B"] }), ctx);
    expect(v.ok && v.steps[0].config).toMatchObject({ voters: ["luca", "marco", "paul"] });
    const tooMany = validateDraft(plan({ ...emptyStep("announce"), message: "hi" }), { organiser: "luca", participants: Array.from({ length: 20 }, (_, i) => `p${i}`) });
    expect(tooMany).toMatchObject({ ok: false, error: expect.stringMatching(/up to 20 people/) });
  });

  it("a single block keeps its familiar kind; mixes are 'composed'", () => {
    const one = validateDraft(plan({ ...emptyStep("question"), question: "Free Sunday?" }), ctx);
    const mix = validateDraft(plan({ ...emptyStep("rsvp"), window: "Thu", time: "19:00" }, { ...emptyStep("assign"), items: ["ball"] }), ctx);
    expect([one.ok && one.parsed.kind, mix.ok && mix.parsed.kind]).toEqual(["question", "composed"]);
  });

  it("the editor round-trips a stored plan", () => {
    const v = validateDraft(heuristicCompose("Organise five-a-side on Thursday at 7pm with @marco and @paul, need 3, someone bring a ball"), ctx);
    if (!v.ok) throw new Error(v.error);
    const draft = draftFromSteps("Five-a-side", v.steps.map((s) => ({ type: s.type, config: s.config })), v.parsed);
    const again = validateDraft(draft, ctx);
    expect(again.ok && again.steps).toEqual(v.steps);
  });
});
