import { expect, it } from "vitest";
import { withReaction } from "@/lib/chat/reactions";

it("optimistic reaction changes preserve other people's counts, including removing your last reaction", () => {
  const initial = { message_id: crypto.randomUUID(), counts: { heart: 2, up: 1 }, mine: "heart" as const };
  const changed = withReaction(initial, "laugh"); expect(changed.counts).toEqual({ heart: 1, up: 1, laugh: 1 }); expect(changed.mine).toBe("laugh");
  expect(withReaction(changed, null)).toMatchObject({ counts: { heart: 1, up: 1, laugh: 0 }, mine: null }); expect(initial.counts).toEqual({ heart: 2, up: 1 });
});
