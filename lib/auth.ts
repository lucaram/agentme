import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAgentForUser, type AgentRow } from "@/lib/data/agents";
import { sessionRestriction } from "@/lib/moderation/session";
import { z } from "zod";
import type { BusinessRole } from "@/lib/business/permissions";
import { adminClient } from "@/lib/supabase/admin";

export type SessionUser = { id: string; email: string | null; emailConfirmed: boolean; isAnonymous: boolean; actorId?: string; businessRole?: BusinessRole | null; working?: boolean };

/** Verified current user (validates the JWT with Supabase Auth), or null. */
export const getUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const result = await supabase.rpc("workspace_context", {});
  if (result.error) throw new Error("Couldn't verify workspace access.");
  const context = z.object({ user_id: z.uuid().nullable(), actor_id: z.uuid(), role: z.enum(["owner", "manager", "staff"]).nullable(), working: z.boolean() }).safeParse(result.data);
  if (!context.success || !context.data.user_id) return null;
  const effective = context.data.user_id === data.user.id ? data.user : (await adminClient().auth.admin.getUserById(context.data.user_id)).data.user;
  if (!effective) return null;
  return { id: effective.id, email: effective.email ?? null, emailConfirmed: Boolean(effective.email_confirmed_at), isAnonymous: Boolean(data.user.is_anonymous), actorId: data.user.id, businessRole: context.data.role, working: context.data.working };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  if (await sessionRestriction(user.id)) redirect("/account-status");
  return user;
}

/** Signed-in user who has created their agent; otherwise redirect to onboarding. */
export const requireAgent = cache(async (): Promise<{ user: SessionUser; agent: AgentRow }> => {
  const user = await requireUser();
  const agent = await getAgentForUser(user.id);
  if (!agent) redirect("/onboarding");
  return { user, agent };
});
