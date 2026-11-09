import { describe, expect, it } from "vitest";
import { dayBucket, groupNotices, needsYou, type NoticeRow } from "@/lib/social/notices";

const n = (id: string, ref: string | null, created_at: string, extra: Partial<NoticeRow> = {}): NoticeRow => ({
  id, text: `update ${id}`, link: null, created_at, seen_at: null, ref_id: ref, kind: "info", needs_action: false, resolved_at: null, ...extra,
});

describe("updates that stay manageable", () => {
  it("groups repeats about the same group on the same day; keeps the rest apart", () => {
    const rows = [n("1", "g1", "2026-11-09T10:00:00Z"), n("2", "g1", "2026-11-09T09:00:00Z"), n("3", "g2", "2026-11-09T08:00:00Z"), n("4", "g1", "2026-11-08T10:00:00Z"), n("5", null, "2026-11-08T09:00:00Z")];
    expect(groupNotices(rows).map((g) => g.items.map((i) => i.id))).toEqual([["1", "2"], ["3"], ["4"], ["5"]]);
  });

  it("buckets by day", () => {
    const now = Date.parse("2026-11-09T12:00:00Z");
    expect(dayBucket("2026-11-09T01:00:00Z", now)).toBe("Today");
    expect(dayBucket("2026-11-08T23:00:00Z", now)).toBe("Yesterday");
    expect(dayBucket("2026-11-05T12:00:00Z", now)).toBe("This week");
    expect(dayBucket("2026-10-20T12:00:00Z", now)).toBe("Older");
  });

  it("what needs you stays pinned until handled", () => {
    expect(needsYou(n("1", "c", "2026-11-09T10:00:00Z", { needs_action: true }))).toBe(true);
    expect(needsYou(n("1", "c", "2026-11-09T10:00:00Z", { needs_action: true, resolved_at: "2026-11-09T11:00:00Z" }))).toBe(false);
    expect(needsYou(n("1", "c", "2026-11-09T10:00:00Z"))).toBe(false);
  });
});
