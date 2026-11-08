import { describe, expect, it } from "vitest";
import { stepWords, who } from "@/lib/plans/wording";

describe("plan wording names the people involved", () => {
  it("one person is never 'each of them'", () => {
    expect(stepWords.question(["marco"])).toBe("Ask @marco personally");
    expect(stepWords.collect(["marco"])).toBe("Ask @marco's agent for");
    expect(stepWords.invite(["marco"])).toBe("Invite @marco to");
    expect(stepWords.vote(["marco"])).toBe("You and @marco vote");
    expect(stepWords.claim(["marco"])).toBe("You and @marco each claim your own");
  });

  it("a few people are named; bigger groups become 'everyone'", () => {
    expect(who(["marco", "paul"])).toBe("@marco and @paul");
    expect(who(["marco", "paul", "eve"])).toBe("@marco, @paul and @eve");
    expect(stepWords.question(["a", "b", "c", "d"])).toBe("Ask each of the 4 people personally");
    expect(stepWords.vote(["a", "b", "c", "d"])).toBe("Everyone votes");
    expect(stepWords.collect(["marco", "paul"])).toBe("Ask the agents of @marco and @paul for");
  });
});
