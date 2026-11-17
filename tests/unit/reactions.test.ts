import { expect, it } from "vitest";
import { reactionOverview, withReaction } from "@/lib/chat/reactions";

it("optimistic reaction changes preserve other people's counts, including removing your last reaction", () => {
  const initial = { message_id: crypto.randomUUID(), counts: { heart: 2, up: 1 }, mine: "heart" as const };
  const changed = withReaction(initial, "laugh"); expect(changed.counts).toEqual({ heart: 1, up: 1, laugh: 1 }); expect(changed.mine).toBe("laugh");
  expect(withReaction(changed, null)).toMatchObject({ counts: { heart: 1, up: 1, laugh: 0 }, mine: null }); expect(initial.counts).toEqual({ heart: 2, up: 1 });
});

it("counts people across every emoji and ranks the most-used types with stable ties", () => {
  const summary = { message_id: crypto.randomUUID(), counts: { heart: 2, up: 4, down: 0, happy: 1, laugh: 2 }, mine: "happy" as const };
  const overview = reactionOverview(summary);
  expect(overview.total).toBe(9); expect(overview.groups.slice(0, 3).map((r) => r.key)).toEqual(["up", "heart", "laugh"]);
  expect(overview.groups).toHaveLength(4);
  expect(reactionOverview(withReaction(summary, "cry")).total).toBe(9);
  expect(reactionOverview(withReaction(summary, null)).total).toBe(8);
  expect(reactionOverview({ ...summary, counts: {}, mine: null })).toEqual({ groups: [], total: 0 });
});
