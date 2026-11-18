import "server-only";
import { restoreIdentityAppearance } from "@/lib/appearance-server";
import { commitAvatar, pruneAvatarFiles } from "@/lib/profile/avatar-server";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { decodeJwt } from "jose";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { asJson } from "@/lib/data/json";
import type { AgentRow } from "@/lib/data/agents";
import { getOrCreateMyAgentConversation, postMessage } from "@/lib/data/chat";
import { validateHandle } from "@/lib/policy/handles";
import { MAX_BUSINESS_NAME, MIN_NAME } from "@/lib/social/limits";
import { BUSINESS_AVATARS } from "@/lib/avatars";
import { normaliseSite } from "@/lib/business/site";
import { allowLocal } from "@/lib/business/fetch";
import { accountRestricted } from "@/lib/moderation/accounts";
import { NotificationState } from "@/lib/notifications/types";

/**
 * One person, several identities. A person signs in with their own account and
 * can manage businesses; each business is a separate identity (its own chats,
 * contacts and inbox). A work session retains the person's own Auth principal;
 * database workspace context selects the business and enforces their live role.
 */
const PERSON_COOKIE = "agentme_person";
export const MAX_BUSINESSES = 5;

async function manages(personId: string, businessAgentId: string) {
  const { data } = await adminClient().from("business_managers").select("role").eq("business_agent_id", businessAgentId).eq("user_id", personId).maybeSingle();
  return Boolean(data);
}

/** The person behind this session: themselves, or (acting as a business) the manager who switched in. */
export async function realPerson(user: { id: string; actorId?: string }, agent: AgentRow): Promise<string | null> {
  if (agent.type === "personal") return user.id;
  const { data, error } = await (await createClient()).rpc("workspace_context", {});
  if (error) throw new Error("Couldn't verify workspace access.");
  const context = data as { user_id?: string; actor_id?: string } | null;
  return context?.user_id === user.id && context.actor_id ? context.actor_id : null;
}

export type Identity = { agentId: string; ownerId: string; handle: string; displayName: string; avatar: string; type: "personal" | "business"; current: boolean; badge: number };

/** Everyone this person can act as: their personal identity and the businesses they manage. */
export async function listIdentities(user: { id: string }, agent: AgentRow): Promise<Identity[]> {
  const state = await identityNotificationState(user, agent);
  return state.accounts.map((account) => ({ ...account, badge: account.notifications.total }));
}

/** One database snapshot for all identities this verified person can use. */
export async function identityNotificationState(user: { id: string }, agent: AgentRow): Promise<NotificationState> {
  const db = adminClient();
  const person = await realPerson(user, agent);
  if (!person) throw new Error("Couldn't verify notification access.");
  const { data, error } = await db.rpc("notification_accounts", { p_actor: person, p_current: user.id });
  if (error) throw new Error("Couldn't load account notifications.");
  return NotificationState.parse(data);
}

/** Sign in as another identity of the same person (their personal one, or a business they manage). */
export async function switchTo(user: { id: string }, agent: AgentRow, targetAgentId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = adminClient();
  const person = await realPerson(user, agent);
  const { data: target } = await db.from("agents").select("id, owner_id, type").eq("id", targetAgentId).maybeSingle();
  if (!person || !target) return { ok: false, error: "Not found." };
  if (await accountRestricted(person) || await accountRestricted(target.owner_id)) return { ok: false, error: "This account is restricted by AGENTME." };
  const allowed = target.owner_id === person || (target.type === "business" && (await manages(person, target.id)));
  if (!allowed) return { ok: false, error: "You can't switch to that account." };
  if (target.owner_id === user.id) return { ok: true };

  if (!(await signInAs(person, target.type === "business" && target.owner_id !== person ? target.id : undefined))) return { ok: false, error: "Couldn't switch. Please try again." };

  // Retire the older impersonation cookie; Auth now retains the person.
  const jar = await cookies();
  jar.delete(PERSON_COOKIE);
  return { ok: true };
}

/** Replace this browser's session with one for `userId` (server-side; no email is sent). */
export async function signInAs(userId: string, businessAgentId?: string): Promise<boolean> {
  const db = adminClient();
  const client = await createClient();
  const raw = await client.auth.getUser();
  if (raw.data.user?.id !== userId) return false;
  if (businessAgentId && !await manages(userId, businessAgentId)) return false;
  const { data: owner } = await db.auth.admin.getUserById(userId);
  const email = owner.user?.email;
  if (!email) return false;
  const { data: link, error } = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !link.properties?.hashed_token) return false;
  const { data: signed, error: signInError } = await client.auth.verifyOtp({ type: "email", token_hash: link.properties.hashed_token });
  if (!signInError && businessAgentId && signed.session) {
    const sessionId = decodeJwt(signed.session.access_token).session_id;
    if (typeof sessionId !== "string") { await client.auth.signOut({ scope: "local" }); return false; }
    const binding = await db.from("business_work_sessions").insert({ session_id: sessionId, business_agent_id: businessAgentId, person_user: userId });
    if (binding.error) { await client.auth.signOut({ scope: "local" }); return false; }
  }
  if (!signInError) await restoreIdentityAppearance();
  return !signInError;
}

/** Businesses added from a personal account have an internal login nobody types. */
export const MANAGED_LOGIN_DOMAIN = "business.agentme.app";
export const isManagedLogin = (email: string | null | undefined) => Boolean(email?.endsWith(`@${MANAGED_LOGIN_DOMAIN}`));

export async function forgetPerson() {
  (await cookies()).delete(PERSON_COOKIE);
}

export { BUSINESS_AVATARS };

/**
 * "Add a business": a separate identity the person manages (its own login is
 * internal: it's only ever opened through the switcher).
 */
export async function createBusinessFor(personId: string, input: { name: string; handle: string; avatar: string; avatarImage?: Buffer | null; about: string; website?: string; hours?: string | null; faqs?: { q: string; a: string }[] }): Promise<{ ok: true; agentId: string } | { ok: false; error: string }> {
  const db = adminClient();
  const person = await db.from("agents").select("type").eq("owner_id", personId).maybeSingle();
  if (person.data?.type !== "personal" || await accountRestricted(personId)) return { ok: false, error: "Use an unrestricted personal account to add a business." };
  const name = input.name.trim().slice(0, MAX_BUSINESS_NAME);
  if (name.length < MIN_NAME) return { ok: false, error: "Give your business a name." };
  const handle = validateHandle(input.handle);
  if (!handle.ok) return { ok: false, error: handle.reason };
  const website = input.website?.trim() ? normaliseSite(input.website, { allowLocal: allowLocal() }) : null;
  if (website && !website.ok) return { ok: false, error: `Website: ${website.error}` };
  const { data: taken } = await db.from("agents").select("id").eq("handle", handle.handle).maybeSingle();
  if (taken) return { ok: false, error: `@${handle.handle} is taken. Try another.` };
  const { count } = await db.from("business_managers").select("*", { count: "exact", head: true }).eq("user_id", personId).eq("role", "owner");
  if ((count ?? 0) >= MAX_BUSINESSES) return { ok: false, error: `You can manage up to ${MAX_BUSINESSES} businesses.` };

  const { data: created, error } = await db.auth.admin.createUser({
    email: `business+${randomUUID()}@${MANAGED_LOGIN_DOMAIN}`,
    password: `${randomUUID()}${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !created.user) return { ok: false, error: "Couldn't create the business. Please try again." };
  const about = input.about.trim().slice(0, 8000);
  const { data: agent, error: agentError } = await db
    .from("agents")
    .insert({
      owner_id: created.user.id,
      handle: handle.handle,
      display_name: name,
      avatar: BUSINESS_AVATARS.includes(input.avatar) ? input.avatar : "🏪",
      type: "business",
      contact_policy: "anyone",
      bio: about.split("\n")[0]?.slice(0, 280) || null,
      business_info: asJson({ about, description: about.slice(0, 500), hours: input.hours ?? null, faqs: input.faqs ?? [], ...(website?.ok ? { website: website.url.toString() } : {}) }),
    })
    .select("id")
    .single();
  if (agentError || !agent) {
    await db.auth.admin.deleteUser(created.user.id);
    return { ok: false, error: agentError?.code === "23505" ? `@${handle.handle} was just taken. Try another.` : "Couldn't create the business." };
  }
  const manager = await db.from("business_managers").insert({ business_agent_id: agent.id, user_id: personId, role: "owner" });
  if (manager.error) { await db.auth.admin.deleteUser(created.user.id); return { ok: false, error: "Couldn't finish creating the business. Please try again." }; }
  if (input.avatarImage) {
    try { await commitAvatar(agent.id, personId, input.avatarImage, input.avatar); }
    catch { await db.auth.admin.deleteUser(created.user.id); await pruneAvatarFiles(); return { ok: false, error: "Couldn't save the business avatar. Please try again." }; }
  }
  await db.from("onboarding_state").insert({ user_id: created.user.id });
  const conv = await getOrCreateMyAgentConversation(created.user.id);
  await postMessage({
    conversationId: conv.id,
    from: "agent",
    agentId: agent.id,
    content: `Hi! I'm @${handle.handle}, ${name}'s agent. I answer visitors from what you tell me in [My Business](/business), and I ask you when I don't know. I never take bookings, orders or payments by myself.`,
  });
  return { ok: true, agentId: agent.id };
}

/** Businesses this person is the only owner of (deleted with their personal account). */
export async function businessesOnlyOwnedBy(personId: string): Promise<{ agentId: string; ownerId: string }[]> {
  const db = adminClient();
  const { data: mine } = await db.from("business_managers").select("business_agent_id").eq("user_id", personId).eq("role", "owner");
  const result: { agentId: string; ownerId: string }[] = [];
  for (const m of mine ?? []) {
    const { count } = await db.from("business_managers").select("*", { count: "exact", head: true }).eq("business_agent_id", m.business_agent_id).eq("role", "owner");
    const { data: biz } = await db.from("agents").select("owner_id").eq("id", m.business_agent_id).single();
    if ((count ?? 0) <= 1 && biz && biz.owner_id !== personId) result.push({ agentId: m.business_agent_id, ownerId: biz.owner_id });
  }
  return result;
}
