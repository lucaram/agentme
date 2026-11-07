import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAgentForUser, type AgentRow } from "@/lib/data/agents";

export type SessionUser = { id: string; email: string | null };

/** Verified current user (validates the JWT with Supabase Auth), or null. */
export const getUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

/** Signed-in user who has created their agent; otherwise redirect to onboarding. */
export const requireAgent = cache(async (): Promise<{ user: SessionUser; agent: AgentRow }> => {
  const user = await requireUser();
  const agent = await getAgentForUser(user.id);
  if (!agent) redirect("/onboarding");
  return { user, agent };
});
