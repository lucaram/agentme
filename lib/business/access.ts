import "server-only";
import { requireAgent } from "@/lib/auth";
import { businessAllows, type BusinessPermission } from "./permissions";

export async function requireBusinessPermission(permission: BusinessPermission = "configure") {
  const context = await requireAgent();
  if (context.agent.type !== "business" || !businessAllows(context.user.businessRole, permission)) throw new Error("Your business role does not allow this action.");
  return context;
}
export async function guardBusinessPermission(permission: BusinessPermission) {
  const context = await requireAgent();
  if (context.agent.type === "business" && !businessAllows(context.user.businessRole, permission)) throw new Error("Your business role does not allow this action.");
  return context;
}
