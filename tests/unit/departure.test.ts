import { describe, expect, it } from "vitest";
import { departureNotes, leftNote, removedAt, removedNote, type Departure } from "@/lib/business/departure";

const OWNER = "00000000-0000-4000-8000-000000000001";
const OWNER_QUIET = "00000000-0000-4000-8000-000000000002";
const MANAGER = "00000000-0000-4000-8000-000000000003";
const STAFF_A = "00000000-0000-4000-8000-000000000004";
const STAFF_B = "00000000-0000-4000-8000-000000000005";

const base = { business: "Caffè Aurora", supervisor: null, supervisorRole: null, owners: [{ id: OWNER, notify: true }, { id: OWNER_QUIET, notify: false }], reports: [] } satisfies Partial<Departure>;
const to = (notes: { to: string }[]) => notes.map((n) => n.to).sort();

describe("leaving a business: who is told in My Agent", () => {
  it("a Manager leaves: Owners who want to know, and every Staff member who reported to them", () => {
    const notes = departureNotes({
      ...base,
      name: "Marco",
      role: "manager",
      reports: [
        { id: STAFF_A, supervisor: OWNER, supervisorName: "Olivia" },
        { id: STAFF_B, supervisor: OWNER, supervisorName: "Olivia" },
      ],
    });
    expect(to(notes)).toEqual([OWNER, STAFF_A, STAFF_B].sort());
    expect(notes.find((n) => n.to === OWNER)!.text).toBe(
      "👋 Marco (Manager) left Caffè Aurora. Any requests assigned to them that weren't answered went back to the team. The 2 Staff who reported to them now report to Olivia.",
    );
    expect(notes.find((n) => n.to === STAFF_A)!.text).toBe("👋 Marco, who you reported to at Caffè Aurora, left the business. You now report to Olivia.");
  });

  it("a Staff member leaves: Owners who want to know, and their Manager (always)", () => {
    const notes = departureNotes({ ...base, name: "Luca", role: "staff", supervisor: MANAGER, supervisorRole: "manager" });
    expect(to(notes)).toEqual([OWNER, MANAGER].sort());
    expect(notes.find((n) => n.to === MANAGER)!.text).toBe("👋 Luca (Staff), who reported to you, left Caffè Aurora. Any requests assigned to them that weren't answered went back to the team.");
  });

  it("an Owner who turned these notes off isn't told, even as the leaver's supervisor", () => {
    const notes = departureNotes({ ...base, name: "Luca", role: "staff", supervisor: OWNER_QUIET, supervisorRole: "owner" });
    expect(to(notes)).toEqual([OWNER]);
  });

  it("an Owner leaves: the other Owners who want to know (no requests or Staff to mention)", () => {
    const notes = departureNotes({ ...base, name: "Paula", role: "owner" });
    expect(notes).toEqual([{ to: OWNER, text: "👋 Paula (Owner) left Caffè Aurora." }]);
  });

  it("nobody is told twice, and someone who reported to the leaver is told as their report", () => {
    const notes = departureNotes({ ...base, owners: [{ id: OWNER, notify: true }], name: "Marco", role: "manager", reports: [{ id: OWNER, supervisor: null, supervisorName: null }] });
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toContain("You now report to the business's Owner.");
  });

  it("the person who left is told their personal account is unchanged", () => {
    expect(leftNote("Caffè Aurora")).toContain("Your personal account, chats and contacts are unchanged");
  });
});

describe("removed by an Owner or Manager: the note in their personal My Agent", () => {
  it("names the business and when, in UTC, and says the personal account is unaffected", () => {
    expect(removedNote("Caffè Aurora", new Date("2026-11-17T14:05:30Z"))).toBe(
      "Your access to Caffè Aurora was removed on 17 Nov 2026 at 14:05 UTC. Your personal account is unaffected: your chats, contacts and plans are as they were.",
    );
    expect(removedAt(new Date("2026-01-03T00:07:00Z"))).toBe("3 Jan 2026 at 00:07 UTC");
  });
});
