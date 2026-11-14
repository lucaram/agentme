import { describe, expect, it } from "vitest";
import { describeRecall, type RecallPlan } from "@/lib/agents/recall-format";
import { mockRecallRoute, recallChoice } from "@/lib/agents/recall-route";

const dinner: RecallPlan = { id: "dinner", title: "Saturday Italian Dinner", kind: "coordinate", organiser: "luca", status: "accepted", createdAt: "", when: "Saturday 21 November 2026 at 7:00 PM", venue: { agent_id: "restaurant", handle: "trattoria", name: "Trattoria Sole" }, rsvp: { in: ["luca", "marco", "paul"], out: [], waiting: [] } };

describe("plan intent precedes business handles", () => {
  it.each(["Trattoria", "@Trattoria"])("answers the %s variant from the same saved plan", (venue) => {
    const text = `What time did we agree for dinner at ${venue} on 21 November, and who is coming?`;
    const route = mockRecallRoute(text, [dinner]);
    expect(route).toEqual({ kind: "recall", matches: [1] });
    expect(recallChoice([dinner], route.matches)).toEqual({ plan: dinner });
    const answer = describeRecall(text, [dinner]);
    for (const fact of ["Trattoria Sole", "21 November 2026 at 7:00 PM", "@luca", "@marco", "@paul", "AGENTME hasn't made a reservation"]) expect(answer).toContain(fact);
  });
  it("asks which plan when multiple dinners match", () => {
    const plans = [dinner, { ...dinner, id: "next", when: "Saturday 28 November 2026 at 8:00 PM" }];
    expect(recallChoice(plans, mockRecallRoute("When is our dinner at @trattoria?", plans).matches)).toMatchObject({ text: expect.stringContaining("Which plan") });
    expect(mockRecallRoute("When is our dinner at @trattoria on 28 November?", plans).matches).toEqual([2]);
  });
  it("keeps missing personal plans local and leaves real business questions to business routing", () => {
    expect(recallChoice([dinner], mockRecallRoute("When is our dinner on 15 November?", [dinner]).matches)).toHaveProperty("text");
    expect(mockRecallRoute("Is @trattoria open on Mondays?", [dinner]).kind).toBe("other");
    expect(mockRecallRoute("@trattoria Can you store four bicycles?", [dinner]).kind).toBe("other");
    expect(mockRecallRoute("Organise dinner at @trattoria with @marco", [dinner]).kind).toBe("other");
    expect(mockRecallRoute("Organise our dinner at @trattoria with @marco", [dinner]).kind).toBe("other");
    expect(mockRecallRoute("@trattoria Who is in charge of deliveries?", [dinner]).kind).toBe("other");
  });
});
