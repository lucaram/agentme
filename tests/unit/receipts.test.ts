import { describe, expect, it } from "vitest";
import { receiptDisplay, type Receipt } from "@/lib/chat/receipts";
import { visibleMessageArea } from "@/lib/client/message-visibility";

const receipt: Receipt = { message_id: "id", sent_at: "2026-11-15T07:00:00Z", kind: "people", group: true, total: 3, delivered: 0, seen: 0, agent_name: null, agent_business: false, agent_received_at: null, owner_seen_at: null, owner_seen_shared: true, recipients: [] };
describe("receipt presentation", () => {
  it("never treats partial group viewing or delivery as everyone seeing a message", () => {
    expect(receiptDisplay({ ...receipt, delivered: 3, seen: 2 })).toMatchObject({ state: "partial", green: false, text: "Seen by 2 of 3" });
    expect(receiptDisplay({ ...receipt, delivered: 3, seen: 3 })).toMatchObject({ state: "seen", green: true });
    expect(receiptDisplay({ ...receipt, group: false, total: 1, delivered: 1 })).toMatchObject({ state: "delivered", icon: "inbox", green: false, text: "" });
  });
  it("does not equate agent acceptance with human viewing, including when sharing is disabled", () => {
    const agent: Receipt = { ...receipt, kind: "agent", group: false, total: 0, agent_business: true, agent_received_at: receipt.sent_at };
    expect(receiptDisplay(agent)).toMatchObject({ state: "agent", text: "Agent received", green: false });
    expect(receiptDisplay({ ...agent, owner_seen_at: receipt.sent_at })).toMatchObject({ state: "seen", text: "Seen by team", green: true });
    expect(receiptDisplay({ ...agent, owner_seen_at: receipt.sent_at, owner_seen_shared: false })).toMatchObject({ state: "agent", green: false });
    expect(receiptDisplay()).toMatchObject({ state: "sent", green: false });
  });
});
describe("actual message viewport", () => {
  const viewport = { top: 120, bottom: 700, width: 1000 };
  const rect = { top: 200, bottom: 300, left: 30, right: 830, width: 800, height: 100 };
  it("excludes content underneath the sticky header, composer or outside the viewport", () => {
    expect(visibleMessageArea(rect, viewport)).toBe(true);
    expect(visibleMessageArea({ ...rect, top: 0, bottom: 100 }, viewport)).toBe(false);
    expect(visibleMessageArea({ ...rect, top: 710, bottom: 810 }, viewport)).toBe(false);
    expect(visibleMessageArea({ ...rect, left: 1100, right: 1900 }, viewport)).toBe(false);
    expect(visibleMessageArea({ ...rect, height: 0 }, viewport)).toBe(false);
  });
  it("requires a useful visible portion rather than a single exposed pixel", () => {
    expect(visibleMessageArea({ ...rect, top: 699, bottom: 799 }, viewport)).toBe(false);
    expect(visibleMessageArea({ ...rect, top: 670, bottom: 770 }, viewport)).toBe(true);
  });
});
