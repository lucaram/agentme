"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type StaffResult = { error?: string; message?: string };
async function changeAccess(args: { p_enabled: boolean; p_email?: string; p_user?: string }): Promise<StaffResult> {
  await requireAgent();
  const { data, error } = await (await createClient()).rpc("set_platform_reviewer", args);
  if (error) return { error: error.message.includes("registered, verified") ? "Use the email of a registered, verified personal account." : error.message.includes("protected") ? "Operator accounts are protected. Their access cannot be removed here." : "Couldn't change access. Check your operator access and try again." };
  const result = z.object({ changed: z.boolean(), email: z.string() }).safeParse(data);
  if (!result.success) return { error: "Couldn't confirm the change. Refresh to check the current access." };
  revalidatePath("/moderation", "layout"); revalidatePath("/settings"); revalidatePath("/chats", "layout");
  return { message: result.data.changed ? `Reviewer access ${args.p_enabled ? "granted to" : "removed for"} ${result.data.email}.` : `${result.data.email} ${args.p_enabled ? "already has reviewer access" : "no longer has reviewer access"}.` };
}
export async function grantReviewer(email: string): Promise<StaffResult> {
  const parsed = z.email().max(254).safeParse(typeof email === "string" ? email.trim().toLowerCase() : email);
  if (!parsed.success) return { error: "Enter a valid account email." };
  return changeAccess({ p_enabled: true, p_email: parsed.data });
}
export async function revokeReviewer(id: string): Promise<StaffResult> {
  if (!z.uuid().safeParse(id).success) return { error: "Invalid staff account." };
  return changeAccess({ p_enabled: false, p_user: id });
}
