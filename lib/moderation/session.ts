import "server-only";
import { getAgentForUser } from "@/lib/data/agents";
import { isManagedLogin, realPerson } from "@/lib/identities";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { decodeJwt } from "jose";
import { accountRestriction } from "./accounts";

/** A manager cannot evade a personal restriction through an already-open business session. */
export async function sessionRestriction(userId: string) {
  const agent = await getAgentForUser(userId);
  if (agent?.type === "business") {
    const person = await realPerson({ id: userId }, agent);
    const unavailable = { id: null, user_key: userId, name: agent.display_name, action: "owner_restricted" as const, justification: "Sign in to your personal account to reopen this managed business session.", created_at: null, expires_at: null };
    if (!person) return unavailable;
    if (person && person !== userId) { const restricted = await accountRestriction(person); if (restricted) return restricted; }
    const db = adminClient();
    const { data: owner } = await db.auth.admin.getUserById(userId);
    if (isManagedLogin(owner.user?.email)) {
      const { data } = await (await createClient()).auth.getSession();
      const id = data.session ? decodeJwt(data.session.access_token).session_id : null;
      if (typeof id !== "string") return unavailable;
      const binding = await db.from("managed_identity_sessions").select("person_user,business_user").eq("session_id", id).maybeSingle();
      if (binding.error) throw new Error("Couldn't verify the managed session.");
      if (binding.data && (binding.data.person_user !== person || binding.data.business_user !== userId)) return unavailable;
      // Upgrade an existing, valid signed manager session without interrupting it.
      if (!binding.data) {
        const saved = await db.from("managed_identity_sessions").insert({ session_id: id, business_user: userId, person_user: person });
        if (saved.error && saved.error.code !== "23505") throw new Error("Couldn't verify the managed session.");
      }
    }
  }
  return accountRestriction(userId);
}
