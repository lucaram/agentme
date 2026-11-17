export const BUSINESS_ROLES = ["owner", "manager", "staff"] as const;
export type BusinessRole = typeof BUSINESS_ROLES[number];
export type BusinessPermission = "read" | "respond" | "configure" | "staff" | "draft" | "presence" | "ownership";
export function businessAllows(role: BusinessRole | null | undefined, permission: BusinessPermission) {
  return role === "owner" || role === "manager" && permission !== "ownership" || role === "staff" && ["read", "respond", "draft", "presence"].includes(permission);
}
