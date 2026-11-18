import { describe, expect, it } from "vitest";
import { describeIncoming } from "@/lib/activity/incoming";

const base = { skill: "business.faq", status: "completed", answered_by: null as string | null, disclosed_categories: [] as string[], request: {} as unknown, response: {} as unknown, error: null as string | null };

describe("what others asked, in plain words", () => {
  it("shows the question and your agent's answer from your public details", () => {
    const row = describeIncoming({ ...base, answered_by: "agent", disclosed_categories: ["business_info"], request: { text: "Are you open on Mondays?" }, response: { text: "No, we're closed on Mondays." } });
    expect(row).toMatchObject({ asked: "Are you open on Mondays?", answer: "No, we're closed on Mondays.", outcome: "agent", outcomeText: "Your agent answered · from your public details" });
  });

  it("drops the @handle a group question was addressed to, and shows your own answer", () => {
    const row = describeIncoming({ ...base, answered_by: "human", disclosed_categories: ["answer"], request: { text: "@trattoria: do you have a piano?" }, response: { text: "Yes.", data: { type: "agentme.question.answer", answer: "Yes, we do." } } });
    expect(row).toMatchObject({ asked: "do you have a piano?", answer: "Yes, we do.", outcome: "you", outcomeText: "You answered" });
  });

  it("puts questions waiting for you apart, with nothing answered yet", () => {
    const row = describeIncoming({ ...base, status: "waiting_human", request: { text: "Do you have a guitar?" }, response: { text: "I don't have that information yet." } });
    expect(row).toMatchObject({ asked: "Do you have a guitar?", answer: null, outcome: "waiting", outcomeText: "Waiting for you" });
  });

  it("says when your agent didn't know, or the question wasn't about the business", () => {
    expect(describeIncoming({ ...base, response: { text: "I don't know.", data: { type: "agentme.business.handoff_offer" } } })).toMatchObject({ outcome: "none", outcomeText: "Your agent didn't know, and offered to ask the team" });
    expect(describeIncoming({ ...base, response: { text: "Ask your own agent.", data: { type: "agentme.business.redirect" } } })).toMatchObject({ outcome: "none", outcomeText: "Not about your business: nothing shared" });
  });

  it("for a plan, lists exactly the details that went out, and nothing outside the shared categories", () => {
    const row = describeIncoming({
      ...base,
      skill: "coordination.availability",
      answered_by: "agent",
      disclosed_categories: ["availability", "food"],
      request: { type: "agentme.coordination.request", event: "dinner", window: "Saturday evening", categories: ["availability", "food"] },
      response: { text: "Saturdays after 7 PM.", data: { type: "agentme.coordination.reply", availability: "Saturdays after 7 PM", food: "Italian, no seafood", budget: "£30", location: null } },
    });
    expect(row).toMatchObject({ plan: true, asked: "dinner, Saturday evening", answer: null, outcome: "agent" });
    expect(row.shared).toEqual([{ label: "Availability", value: "Saturdays after 7 PM" }, { label: "Food preferences", value: "Italian, no seafood" }]);
  });

  it("explains refusals and failures without technical details", () => {
    expect(describeIncoming({ ...base, status: "refused", answered_by: "human", error: "@trattoria preferred not to answer." })).toMatchObject({ outcome: "you", outcomeText: "You chose not to answer" });
    expect(describeIncoming({ ...base, status: "refused", error: "not a contact" })).toMatchObject({ outcome: "none", outcomeText: "Refused: Not a contact" });
    expect(describeIncoming({ ...base, status: "failed", error: "fetch failed: ECONNRESET" })).toMatchObject({ outcome: "none", outcomeText: "Not answered: something went wrong, nothing shared" });
  });

  it("copes with missing or odd data", () => {
    expect(describeIncoming({ ...base, request: null, response: "x" })).toMatchObject({ asked: null, answer: null, outcome: "agent" });
  });
});
