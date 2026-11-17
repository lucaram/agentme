import type { BusinessRole } from "./permissions";

export type AssignmentMember = { id: string; name: string; role: string; supervisorId?: string | null };
export const teamRoleLabel = (role: string) => role === "owner" ? "Owner" : role === "manager" ? "Manager" : "Staff";

/** The current person uses “I'll handle this”; managers delegate to Staff. */
export function assignmentOptions(members: AssignmentMember[], actor: string, role: BusinessRole | null | undefined) {
  if (role !== "owner" && role !== "manager") return [];
  return members.filter((member) => member.id !== actor && (role === "owner" || member.role === "staff" && member.supervisorId === actor));
}
