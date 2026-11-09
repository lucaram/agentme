import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { asJson } from "@/lib/data/json";
import type { AgentRow } from "@/lib/data/agents";
import { getOrCreateMyAgentConversation, postMessage } from "@/lib/data/chat";
import { validateHandle } from "@/lib/policy/handles";
import { sameHash } from "@/lib/people/crypto";
import { MAX_BUSINESS_NAME, MIN_NAME } from "@/lib/social/limits";
import { BUSINESS_AVATARS } from "@/lib/avatars";

/**
 * One person, several identities. A person signs in with their own account and
 * can manage businesses; each business is a separate identity (its own chats,
 * contacts and inbox). Switching signs the person in as that identity; a
 * signed cookie remembers who the person is, so they can switch back.
 */
const PERSON_COOKIE = "agentme_person";
const COOKIE_DAYS = 30;
export const MAX_BUSINESSES = 5;

const key = () => createHmac("sha256", env.a2aSigningSecret).update("agentme:identity:v1").digest();
const sign = (value: string) => createHmac("sha256", key()).update(value).digest("base64url");

function personCookieValue(personId: string) {
  const exp = Math.floor(Date.now() / 1000) + COOKIE_DAYS * 86400;
  return `${personId}.${exp}.${sign(`${personId}.${exp}`)}`;
}

function readPersonCookie(value: string | undefined): string | null {
  const [personId, exp, sig] = (value ?? "").split(".");
  if (!personId || !exp || !sig || Number(exp) * 1000 < Date.now()) return null;
  return sameHash(sig, sign(`${personId}.${exp}`)) ? personId : null;
}

async function manages(personId: string, businessAgentId: string) {
  const { data } = await adminClient().from("business_managers").select("role").eq("business_agent_id", businessAgentId).eq("user_id", personId).maybeSingle();
  return Boolean(data);
}

/** The person behind this session: themselves, or (acting as a business) the manager who switched in. */
export async function realPerson(user: { id: string }, agent: AgentRow): Promise<string | null> {
  if (agent.type === "personal") return user.id;
  const personId = readPersonCookie((await cookies()).get(PERSON_COOKIE)?.value);
  if (personId && (await manages(personId, agent.id))) return personId;
  // Signed in directly as a business (its own login): the business is its own person.
  return user.id;
}

export type Identity = { agentId: string; ownerId: string; handle: string; displayName: string; avatar: string; type: "personal" | "business"; current: boolean; badge: number };

/** Everyone this person can act as: their personal identity and the businesses they manage. */
export async function listIdentities(user: { id: string }, agent: AgentRow): Promise<Identity[]> {
  const db = adminClient();
  const person = await realPerson(user, agent);
  if (!person) return [];
  const { data: managed } = await db.from("business_managers").select("business_agent_id").eq("user_id", person);
  const businessIds = (managed ?? []).map((m) => m.business_agent_id);
  const { data: agents } = await db
    .from("agents")
    .select("id, owner_id, handle, display_name, avatar, type")
    .or(`owner_id.eq.${person}${businessIds.length ? `,id.in.(${businessIds.join(",")})` : ""}`);
  const list = (agents ?? []).sort((a, b) => Number(a.type === "business") - Number(b.type === "business") || a.display_name.localeCompare(b.display_name));
  return Promise.all(
    list.map(async (a) => {
      const current = a.owner_id === user.id;
      const { data: badge } = current ? { data: 0 } : await db.rpc("identity_badge", { p_user: a.owner_id });
      return {
        agentId: a.id,
        ownerId: a.owner_id,
        handle: a.handle,
        displayName: a.display_name,
        avatar: a.avatar,
        type: a.type as "personal" | "business",
        current,
        badge: Number(badge ?? 0),
      };
    }),
  );
}

/** Sign in as another identity of the same person (their personal one, or a business they manage). */
export async function switchTo(user: { id: string }, agent: AgentRow, targetAgentId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = adminClient();
  const person = await realPerson(user, agent);
  const { data: target } = await db.from("agents").select("id, owner_id, type").eq("id", targetAgentId).maybeSingle();
  if (!person || !target) return { ok: false, error: "Not found." };
  const allowed = target.owner_id === person || (target.type === "business" && (await manages(person, target.id)));
  if (!allowed) return { ok: false, error: "You can't switch to that account." };
  if (target.owner_id === user.id) return { ok: true };

  if (!(await signInAs(target.owner_id))) return { ok: false, error: "Couldn't switch. Please try again." };

  // Remember the person while acting as a business, so they can switch back.
  const jar = await cookies();
  if (target.owner_id === person) jar.delete(PERSON_COOKIE);
  else jar.set(PERSON_COOKIE, personCookieValue(person), { httpOnly: true, sameSite: "lax", secure: env.appUrl.startsWith("https://"), path: "/", maxAge: COOKIE_DAYS * 86400 });
  return { ok: true };
}

/** Replace this browser's session with one for `userId` (server-side; no email is sent). */
export async function signInAs(userId: string): Promise<boolean> {
  const db = adminClient();
  const { data: owner } = await db.auth.admin.getUserById(userId);
  const email = owner.user?.email;
  if (!email) return false;
  const { data: link, error } = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !link.properties?.hashed_token) return false;
  const { error: signInError } = await (await createClient()).auth.verifyOtp({ type: "email", token_hash: link.properties.hashed_token });
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
export async function createBusinessFor(personId: string, input: { name: string; handle: string; avatar: string; about: string }): Promise<{ ok: true; agentId: string } | { ok: false; error: string }> {
  const db = adminClient();
  const name = input.name.trim().slice(0, MAX_BUSINESS_NAME);
  if (name.length < MIN_NAME) return { ok: false, error: "Give your business a name." };
  const handle = validateHandle(input.handle);
  if (!handle.ok) return { ok: false, error: handle.reason };
  const { data: taken } = await db.from("agents").select("id").eq("handle", handle.handle).maybeSingle();
  if (taken) return { ok: false, error: `@${handle.handle} is taken. Try another.` };
  const { count } = await db.from("business_managers").select("*", { count: "exact", head: true }).eq("user_id", personId);
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
      business_info: asJson({ about, description: about.slice(0, 500) }),
    })
    .select("id")
    .single();
  if (agentError || !agent) {
    await db.auth.admin.deleteUser(created.user.id);
    return { ok: false, error: agentError?.code === "23505" ? `@${handle.handle} was just taken. Try another.` : "Couldn't create the business." };
  }
  await db.from("business_managers").insert({ business_agent_id: agent.id, user_id: personId, role: "owner" });
  const conv = await getOrCreateMyAgentConversation(created.user.id);
  await postMessage({
    conversationId: conv.id,
    from: "agent",
    agentId: agent.id,
    content: `Hi! I'm @${handle.handle}, ${name}'s agent. I answer visitors from what you tell me in My Business, and I ask you when I don't know. I never take bookings, orders or payments by myself.`,
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
