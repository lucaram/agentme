import { describe, expect, it } from "vitest";
import { heuristicCompose, withQuoted } from "@/lib/plans/compose";
import { replyFor } from "@/lib/client/reply";

describe("↩ Reply + a plan: the quoted message says what is being organised", () => {
  const quoted = "Dinner at Trattoria Sole on Saturday evening, table for four";

  it("on its own, 'Organise this with @marco' has no event or day", () => {
    const alone = heuristicCompose("Organise this with @marco");
    expect(alone.kind).toBe("plan");
    expect(alone.steps[0]).toMatchObject({ event: "meetup", window: "this week" });
  });

  it("with the quoted message, the event and the day come from it", () => {
    const plan = heuristicCompose(withQuoted("Organise this with @marco", quoted));
    expect(plan.kind).toBe("plan");
    expect(plan.steps[0]).toMatchObject({ event: "dinner", window: "Saturday evening" });
  });

  it("in a chat ('@agent organise this'), the chat's members are involved and the quote says what for", () => {
    const plan = heuristicCompose(withQuoted("organise this", "Dinner at the new place on Saturday evening, who's up for it"), ["luca"]);
    expect(plan.kind).toBe("plan");
    expect(plan.steps[0]).toMatchObject({ type: "collect", event: "dinner", window: "Saturday evening" });
  });

  it("people named in the quoted message are never added: only the owner's own @mentions count", () => {
    expect(withQuoted("Organise this with @marco", "@paul and @eve are in for dinner on Saturday")).toBe("Organise this with @marco — and are in for dinner on Saturday");
    // Nobody mentioned by the owner: still not a plan, whatever the quote says.
    expect(heuristicCompose(withQuoted("Organise this", "@paul wants dinner on Saturday")).kind).toBe("chat");
  });

  it("no quote changes nothing; a long one is cut", () => {
    expect(withQuoted("Plan lunch with @paul on Sunday")).toBe("Plan lunch with @paul on Sunday");
    expect(withQuoted("Plan lunch with @paul", "   ")).toBe("Plan lunch with @paul");
    expect(withQuoted("x", "y".repeat(5000)).length).toBeLessThanOrEqual(604);
  });
});

describe("↩ Reply stays in the request it was chosen in (My Agent threads share one conversation)", () => {
  const chosen = { id: "m1", author: "Luca's agent", snippet: "Here's the plan", conversationId: "c1", thread: "thread-a" };

  it("shows in the thread it was chosen in", () => {
    expect(replyFor(chosen, "c1", "thread-a")).toMatchObject({ id: "m1" });
  });

  it("doesn't carry into another request, a new request, or another chat", () => {
    expect(replyFor(chosen, "c1", "thread-b")).toBeNull();
    expect(replyFor(chosen, "c1", "")).toBeNull(); // the list of requests / a new request
    expect(replyFor(chosen, "c2", "thread-a")).toBeNull();
    expect(replyFor(null, "c1", "thread-a")).toBeNull();
  });

  it("in a chat without threads, it is simply the chat's", () => {
    const inGroup = { ...chosen, thread: "" };
    expect(replyFor(inGroup, "c1", "")).toMatchObject({ id: "m1" });
  });
});
