import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/database.types";

/** Fresh, agent-less accounts for signup tests. Never seeds or modifies demo identities. */
export async function onboardingFixture() {
  const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const tag = crypto.randomUUID().slice(0, 8); const users: string[] = []; const password = "onboarding-test-password";
  const user = async () => {
    const email = `onboard_${tag}_${users.length}@agentme.test`;
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true }); if (error) throw error;
    users.push(data.user.id); return { id: data.user.id, email };
  };
  const cleanup = async () => {
    if (!users.length) return;
    const managed = await db.from("business_managers").select("business_agent_id").in("user_id", users);
    if (managed.data?.length) {
      const businesses = await db.from("agents").select("owner_id").in("id", managed.data.map((m) => m.business_agent_id));
      for (const b of businesses.data ?? []) if (!users.includes(b.owner_id)) users.push(b.owner_id);
    }
    await db.from("conversations").delete().in("created_by", users);
    for (const id of users) await db.auth.admin.deleteUser(id);
  };
  return { db, tag, password, user, cleanup };
}
