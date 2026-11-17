import { z } from "zod";

/**
 * Leaving a business: who is told, and what, in their own My Agent. Pure (unit-tested).
 *  - Manager leaves: the Owners (unless they turned these notes off) and the Staff who reported to them.
 *  - Staff leaves: the Owners (same choice) and the Manager they reported to.
 *  - Owner leaves (only possible when another Owner remains): the other Owners (same choice).
 * The person who reported to the leaver is always told, whatever the Owners chose: it changes
 * who they work for.
 */
export const Departure = z.object({
  business: z.string(),
  name: z.string(),
  role: z.enum(["owner", "manager", "staff"]),
  supervisor: z.uuid().nullable(),
  supervisorRole: z.string().nullable(),
  owners: z.array(z.object({ id: z.uuid(), notify: z.boolean() })),
  reports: z.array(z.object({ id: z.uuid(), supervisor: z.uuid().nullable(), supervisorName: z.string().nullable() })),
});
export type Departure = z.infer<typeof Departure>;

export type DepartureNote = { to: string; text: string };

const ROLE = { owner: "Owner", manager: "Manager", staff: "Staff" } as const;

export function departureNotes(d: Departure): DepartureNote[] {
  const notes = new Map<string, string>();
  const who = `${d.name} (${ROLE[d.role]})`;
  const released = d.role === "owner" ? "" : " Any requests assigned to them that weren't answered went back to the team.";

  // The person each report now reports to, by name (usually the receiving Owner).
  const movedTo = [...new Set(d.reports.map((r) => r.supervisorName ?? "the business's Owner"))];
  const moved = d.reports.length
    ? ` ${d.reports.length === 1 ? "The Staff member" : `The ${d.reports.length} Staff`} who reported to them now ${d.reports.length === 1 ? "reports" : "report"} to ${movedTo.join(" and ")}.`
    : "";

  for (const owner of d.owners) {
    if (owner.notify) notes.set(owner.id, `👋 ${who} left ${d.business}.${released}${moved}`);
  }
  // Staff who reported to a leaving Manager (or Owner): always told who they report to now.
  for (const report of d.reports) {
    notes.set(report.id, `👋 ${d.name}, who you reported to at ${d.business}, left the business. You now report to ${report.supervisorName ?? "the business's Owner"}.`);
  }
  // A leaving Staff member's own Manager is always told (an Owner supervisor follows their own choice above).
  if (d.role === "staff" && d.supervisor && d.supervisorRole === "manager") {
    notes.set(d.supervisor, `👋 ${who}, who reported to you, left ${d.business}.${released}`);
  }
  return [...notes].map(([to, text]) => ({ to, text }));
}

/** "17 Nov 2026 at 14:05 UTC": when access was removed, the same however later it is read. */
export function removedAt(at: Date): string {
  const day = at.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const time = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  return `${day} at ${time} UTC`;
}

/** What someone removed from a business by an Owner or Manager sees in their own (personal) My Agent. */
export const removedNote = (business: string, at: Date) =>
  `Your access to ${business} was removed on ${removedAt(at)}. Your personal account is unaffected: your chats, contacts and plans are as they were.`;

/** What the person who left sees in their own My Agent. */
export const leftNote = (business: string) =>
  `You left ${business}. Your personal account, chats and contacts are unchanged, and your past work there stays in the business's records. To work with ${business} again, an Owner or Manager can invite you.`;
