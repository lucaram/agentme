import { describe, expect, it } from "vitest";
import { EMPTY_MENTION_BATCH, MENTION_BANNER_MS, mentionBatchLabel, mergeMentionBatch } from "@/lib/chat/mention-batch";
import type { MentionAlert } from "@/lib/chat/mentions";

const alert = (id: string, chat = "dinner"): MentionAlert => ({ message_id: id, conversation_id: chat, created_at: "2026-11-16T12:00:00Z", sender: "Marco", avatar: "M", chat_name: chat });
describe("new mention batches", () => {
  it("groups separate arrivals and resets the ten-second timer only for new IDs", () => {
    const first = mergeMentionBatch(EMPTY_MENTION_BATCH, [alert("1")]);
    expect(mentionBatchLabel(first.items)).toBe("Marco mentioned you in dinner.");
    expect(mergeMentionBatch(first, [alert("1")])).toBe(first);
    const second = mergeMentionBatch(first, [alert("2")]);
    expect(second.generation).toBe(first.generation + 1);
    expect(mentionBatchLabel(second.items)).toBe("2 new mentions in dinner");
    const third = mergeMentionBatch(second, [alert("3", "work")]);
    expect(mentionBatchLabel(third.items)).toBe("3 new mentions in 2 chats");
    expect(MENTION_BANNER_MS).toBe(10000);
  });
  it("reconciles only the request's checked IDs, preserving newer arrivals during overlapping refreshes", () => {
    const batch = mergeMentionBatch(EMPTY_MENTION_BATCH, [alert("1"), alert("2"), alert("3")]);
    const next = mergeMentionBatch(batch, [], undefined, ["1", "2"], ["2"]);
    expect(next.items.map((item) => item.message_id)).toEqual(["2", "3"]);
    expect(next.generation).toBe(batch.generation);
    expect(mergeMentionBatch(next, [], undefined, ["2", "3"], ["2", "3"])).toBe(next);
  });
  it("suppresses the active chat and starts a fresh batch after dismissal", () => {
    const batch = mergeMentionBatch(EMPTY_MENTION_BATCH, [alert("1"), alert("2", "work")], "dinner");
    expect(batch.items.map((item) => item.message_id)).toEqual(["2"]);
    expect(mergeMentionBatch(batch, [], "work").items).toEqual([]);
    const dismissed = { items: [], generation: batch.generation };
    const next = mergeMentionBatch(dismissed, [alert("3")]);
    expect(next.items.map((item) => item.message_id)).toEqual(["3"]);
    expect(mentionBatchLabel([])).toBe("");
  });
});
