"use server";

import { MAX_PERSON_NAME, MIN_NAME } from "@/lib/social/limits";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getUser, requireAgent } from "@/lib/auth";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getAgentForUser } from "@/lib/data/agents";
import { getOrCreateMyAgentConversation, postMessage } from "@/lib/data/chat";
import { validateHandle } from "@/lib/policy/handles";
import { AVATARS } from "@/lib/avatars";
import { describeRetry, hit } from "@/lib/limits";
import { joinPlan, loadInvite } from "@/lib/plans/invites";

export type JoinState = { error?: string } | undefined;

/** Someone with an AGENTME account joins the plan. */
export async function joinPlanAction(token: string): Promise<JoinState> {
  const { user, agent } = await requireAgent();
  const result = await joinPlan(token, user.id, agent);
  if (!result.ok) return { error: result.error };
  redirect(`/chats/${result.conversationId}`);
}

const Guest = z.object({
  display_name: z.string().trim().min(MIN_NAME, "Enter your name (at least 2 characters).").max(MAX_PERSON_NAME),
  handle: z.string(),
  avatar: z.string().refine((a) => AVATARS.includes(a), "Pick an avatar."),
});

/**
 * Join as a guest: no email, no password. Creates an anonymous account and a
 * personal agent (private by default), then joins the plan. The guest can save
 * the account later with an email and password.
 */
export async function joinAsGuestAction(token: string, _prev: JoinState, form: FormData): Promise<JoinState> {
  const invite = await loadInvite(token);
  if (!invite) return { error: "This invite link has expired or was turned off." };
  const parsed = Guest.safeParse({ display_name: form.get("display_name"), handle: form.get("handle"), avatar: form.get("avatar") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const handle = validateHandle(parsed.data.handle);
  if (!handle.ok) return { error: handle.reason };
  const db = adminClient();
  const { data: taken } = await db.from("agents").select("id").eq("handle", handle.handle).maybeSingle();
  if (taken) return { error: `@${handle.handle} is taken. Try another.` };

  let user = await getUser();
  if (user && (await getAgentForUser(user.id))) redirect(`/join/${token}`);
  if (!user) {
    const limit = await hit("guestJoinsPerInvite", token);
    if (!limit.allowed) return { error: `Too many people joined from this link just now. Try again in ${describeRetry(limit.retryAfterSeconds)}.` };
    const { data, error } = await (await createClient()).auth.signInAnonymously();
    if (error || !data.user) return { error: "Guest access isn't available right now. Create an account instead." };
    user = { id: data.user.id, email: null, emailConfirmed: false, isAnonymous: true };
  }

  const { data: agent, error } = await db
    .from("agents")
    .insert({
      owner_id: user.id,
      handle: handle.handle,
      display_name: parsed.data.display_name,
      avatar: parsed.data.avatar,
      type: "personal",
      contact_policy: "contacts_only",
      guest: true,
    })
    .select("*")
    .single();
  if (error || !agent) return { error: error?.code === "23505" ? `@${handle.handle} was just taken. Try another.` : "Couldn't create your guest account." };

  const conv = await getOrCreateMyAgentConversation(user.id);
  await postMessage({
    conversationId: conv.id,
    from: "agent",
    agentId: agent.id,
    content: `Hi ${parsed.data.display_name}! I'm @${handle.handle}, your agent. You joined ${invite.organiser.display_name}'s plan as a guest. To keep your account on other devices, save it with an email in Settings.`,
  });
  const result = await joinPlan(token, user.id, agent);
  if (!result.ok) return { error: result.error };
  redirect(`/chats/${result.conversationId}`);
}
