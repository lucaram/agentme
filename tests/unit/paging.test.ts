import { describe, expect, it } from "vitest";
import { compareMessages, MAX_RENDERED_MESSAGES, MESSAGES_PER_PAGE } from "@/lib/social/paging";
import { mergeHistory, messageWindow } from "@/lib/chat/history-window";
import { EMPTY_HISTORY, type HistoryBundle, type HistoryMessage } from "@/lib/chat/history-types";

describe("bounded history windows", () => {
  const message = (id: string, text = id) => ({ id, content: text, created_at: "2026-11-15T10:00:00Z" } as HistoryMessage);
  it("orders equal timestamps consistently and replaces overlapping updates without duplicates", () => {
    const a = message("a"); const b = message("b");
    expect(compareMessages(a, b)).toBeLessThan(0);
    const result = messageWindow([[b, a], [message("a", "Message deleted")]], "after");
    expect(result.messages.map((m) => m.id)).toEqual(["a", "b"]); expect(result.messages[0].content).toBe("Message deleted");
  });

  it("prunes the opposite end of the DOM window without discarding cursor access to older history", () => {
    const rows = Array.from({ length: 4 * MESSAGES_PER_PAGE }, (_, i) => message(String(i).padStart(4, "0")));
    const older = messageWindow([rows], "before"); const newer = messageWindow([rows], "after");
    expect(older.messages).toHaveLength(MAX_RENDERED_MESSAGES); expect(newer.messages).toHaveLength(MAX_RENDERED_MESSAGES);
    expect(older.messages[0].id).toBe("0000"); expect(newer.messages.at(-1)!.id).toBe("0199");
    expect(older.all).toHaveLength(200); expect(newer.messages[0].id).toBe("0050");
  });
  it("preserves PostgreSQL microsecond ordering rather than treating an entire millisecond as a tie", () => {
    expect(compareMessages({ id: "z", created_at: "2026-11-15T10:00:00.123001+00:00" }, { id: "a", created_at: "2026-11-15T10:00:00.123999Z" })).toBeLessThan(0);
    expect(compareMessages({ id: "a", created_at: "2026-11-15T11:00:00.123+01:00" }, { id: "b", created_at: "2026-11-15T10:00:00.123000Z" })).toBeLessThan(0);
  });
  const bundle = (): HistoryBundle => ({ ...EMPTY_HISTORY, revision: "v", userId: "u", agent: { id: "a", handle: "luca" }, conversationId: "c", threadId: null, kind: "group", canReplyHere: true, canModerate: false, suspended: false, agents: [], attachments: [], tasks: [], exchanges: [], proposals: [], steps: [], responses: [], claims: [], facts: [], quotes: [], receipts: [], reactions: [], actions: [], legacy: [] });
  it("removes cached media and receipt summaries when an overlapping page contains a deletion", () => {
    const original = { ...message("m"), metadata: {}, removed_at: null };
    const base = { ...bundle(), messages: [original], attachments: [{ id: "file", message_id: "m", name: "notes.txt", mime: "text/plain", kind: "document" as const, bytes: 10 }], receipts: [{ message_id: "m" } as HistoryBundle["receipts"][number]] };
    const fresh = { ...bundle(), messages: [{ ...original, content: "Deleted message", removed_at: "2026-11-15T10:01:00Z" }] };
    const result = mergeHistory(base, [fresh], "before");
    expect(result.messages[0].content).toBe("Deleted message"); expect(result.attachments).toEqual([]); expect(result.receipts).toEqual([]);
  });
  it("refreshing a card clears withdrawn claims while retaining its activity", () => {
    const base = { ...bundle(), messages: [{ ...message("m"), metadata: { kind: "assign", task_id: "task", step_id: "step" } }],
      tasks: [{ id: "task", parsed: {} } as HistoryBundle["tasks"][number]], steps: [{ id: "step", task_id: "task", config: {} } as HistoryBundle["steps"][number]], claims: [{ step_id: "step", item: "Drinks", agent_id: "a", created_at: "2026-11-15T10:00:00Z" }] };
    expect(mergeHistory(base, [base], "refresh").claims).toHaveLength(1);
    const result = mergeHistory(base, [{ ...base, claims: [] }], "replace"); expect(result.claims).toEqual([]); expect(result.tasks).toHaveLength(1);
  });
});
