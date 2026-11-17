import { createClient } from "@supabase/supabase-js";
import { decodeJwt } from "jose";
import { planBusinessFixture } from "./plan-business";
import type { Database } from "../../lib/database.types";

/** Disposable accounts only. Work tokens retain the actual human Auth user. */
export async function businessStaffFixture() {
  const f = await planBusinessFixture();
  const signed = async (person: { email: string; userId: string }, work = false) => {
    const client = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const result = await client.auth.signInWithPassword({ email: person.email, password: f.password }); if (result.error) throw result.error;
    if (work) { const inserted = await f.db.from("business_work_sessions").insert({ person_user: person.userId, business_agent_id: f.business.agent.id, session_id: decodeJwt(result.data.session!.access_token).session_id as string }); if (inserted.error) throw inserted.error; }
    return client;
  };
  const membership = await f.db.from("business_managers").insert({ business_agent_id: f.business.agent.id, user_id: f.business.userId, role: "owner" });
  if (membership.error) { await f.cleanup(); throw membership.error; }
  const owner = await signed(f.business);
  return { ...f, owner, signed, cleanup: async () => { await f.cleanup(); for (const person of [f.luca,f.marco,f.paul,f.business]) { const remaining = await f.db.auth.admin.getUserById(person.userId); if (remaining.data.user) throw new Error(`Fixture cleanup failed for ${person.agent.handle}`); } } };
}
