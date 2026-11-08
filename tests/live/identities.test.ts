/**
 * One person, several identities: "Add a business" creates a separate identity
 * the person manages, with its own chats and inbox, and a badge in the switcher.
 * Throwaway users, deleted afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, SUPABASE_URL, admin, dbUp } from "./env";

type AgentRow = NonNullable<Awaited<ReturnType<typeof import("@/lib/data/agents").getAgentById>>>;
const run = Math.random().toString(36).slice(2, 7);
const PASSWORD = "identity-test-password";
const people: Record<"p" | "q", { userId: string; email: string; agent: AgentRow }> = {} as never;
const extraUsers: string[] = [];
let biz: { agentId: string; ownerId: string } | null = null;

const lib = () => import("@/lib/identities");
const signedIn = async (email: string) => {
  const c = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return c;
};

describe.skipIf(!dbUp)("business identities (live)", () => {
  beforeAll(async () => {
    const db = admin();
    for (const key of ["p", "q"] as const) {
      const handle = `ti${run}_${key}`;
      const email = `${handle}@identity.test`;
      const { data: created, error } = await db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      if (error) throw error;
      const { data: agent } = await db.from("agents").insert({ owner_id: created.user.id, handle, display_name: `Test ${key}`, avatar: "🦊" }).select("*").single();
      people[key] = { userId: created.user.id, email, agent: agent! };
    }
  });

  afterAll(async () => {
    const db = admin();
    const ids = [...Object.values(people).map((p) => p.userId), ...extraUsers];
    await db.from("conversations").delete().in("created_by", ids);
    for (const id of ids) await db.auth.admin.deleteUser(id);
  });

  it("adds a business as a separate identity the person owns", async () => {
    const { createBusinessFor, isManagedLogin } = await lib();
    const made = await createBusinessFor(people.p.userId, { name: "Pasta Place", handle: `tb${run}`, avatar: "🍝", about: "Fresh pasta in Camden.\nOpen daily." });
    expect(made.ok).toBe(true);
    const db = admin();
    const { data: agent } = await db.from("agents").select("*").eq("id", (made as { agentId: string }).agentId).single();
    biz = { agentId: agent!.id, ownerId: agent!.owner_id };
    extraUsers.push(agent!.owner_id);
    expect(agent).toMatchObject({ type: "business", contact_policy: "anyone", display_name: "Pasta Place", avatar: "🍝", bio: "Fresh pasta in Camden." });
    // Its own login, never the person's.
    expect(agent!.owner_id).not.toBe(people.p.userId);
    const { data: login } = await db.auth.admin.getUserById(agent!.owner_id);
    expect(isManagedLogin(login.user?.email)).toBe(true);
    const { data: manager } = await db.from("business_managers").select("user_id, role").eq("business_agent_id", agent!.id).single();
    expect(manager).toEqual({ user_id: people.p.userId, role: "owner" });
    // Its own My Agent chat, with a welcome.
    const { data: conv } = await db.from("conversations").select("id").eq("kind", "my_agent").eq("created_by", agent!.owner_id).single();
    const { count } = await db.from("messages").select("*", { count: "exact", head: true }).eq("conversation_id", conv!.id);
    expect(count).toBe(1);
  });

  it("rejects taken or invalid addresses", async () => {
    const { createBusinessFor } = await lib();
    expect(await createBusinessFor(people.p.userId, { name: "Again", handle: `tb${run}`, avatar: "🍝", about: "" })).toMatchObject({ ok: false, error: expect.stringContaining("taken") });
    expect(await createBusinessFor(people.p.userId, { name: "Bad", handle: "x!", avatar: "🍝", about: "" })).toMatchObject({ ok: false });
    expect(await createBusinessFor(people.p.userId, { name: " ", handle: `tc${run}`, avatar: "🍝", about: "" })).toMatchObject({ ok: false, error: expect.stringContaining("name") });
  });

  it("lists the person's identities, with a badge for what's waiting in the other one", async () => {
    const { listIdentities } = await lib();
    const list = await listIdentities({ id: people.p.userId }, people.p.agent);
    expect(list.map((i) => [i.type, i.current])).toEqual([
      ["personal", true],
      ["business", false],
    ]);
    // The welcome message is unread in the business's My Agent chat.
    expect(list[1].badge).toBe(1);
    // Someone else sees only their own identity.
    const other = await listIdentities({ id: people.q.userId }, people.q.agent);
    expect(other.map((i) => i.handle)).toEqual([people.q.agent.handle]);
  });

  it("keeps identities separate: the person's login can't read the business's chats", async () => {
    const p = await signedIn(people.p.email);
    const { data: convs } = await p.from("conversations").select("id, created_by");
    expect((convs ?? []).some((c) => c.created_by === biz!.ownerId)).toBe(false);
    // They do see that they manage it; a stranger doesn't.
    const { data: mine } = await p.from("business_managers").select("business_agent_id");
    expect(mine?.map((m) => m.business_agent_id)).toEqual([biz!.agentId]);
    const q = await signedIn(people.q.email);
    const { data: theirs } = await q.from("business_managers").select("business_agent_id");
    expect(theirs).toEqual([]);
    // The badge function is server-only.
    const { error } = await p.rpc("identity_badge", { p_user: biz!.ownerId });
    expect(error).not.toBeNull();
  });

  it("deletes with the person only the businesses nobody else owns", async () => {
    const { businessesOnlyOwnedBy } = await lib();
    expect(await businessesOnlyOwnedBy(people.p.userId)).toEqual([biz]);
    await admin().from("business_managers").insert({ business_agent_id: biz!.agentId, user_id: people.q.userId, role: "owner" });
    expect(await businessesOnlyOwnedBy(people.p.userId)).toEqual([]);
    await admin().from("business_managers").delete().eq("business_agent_id", biz!.agentId).eq("user_id", people.q.userId);
  });

  it("caps how many businesses one person manages", async () => {
    const { createBusinessFor, MAX_BUSINESSES } = await lib();
    for (let i = 1; i < MAX_BUSINESSES; i++) {
      const made = await createBusinessFor(people.p.userId, { name: `Shop ${i}`, handle: `tb${run}${i}`, avatar: "🏪", about: "" });
      expect(made.ok).toBe(true);
      const { data } = await admin().from("agents").select("owner_id").eq("id", (made as { agentId: string }).agentId).single();
      extraUsers.push(data!.owner_id);
    }
    const over = await createBusinessFor(people.p.userId, { name: "One too many", handle: `tb${run}x`, avatar: "🏪", about: "" });
    expect(over).toMatchObject({ ok: false, error: expect.stringContaining(`${MAX_BUSINESSES}`) });
  });
});
