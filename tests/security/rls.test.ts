/**
 * Row Level Security: a signed-in user talking to Supabase directly (bypassing
 * the app) can't read other people's private data or write anything.
 * Requires the local Supabase stack + seed; skipped otherwise.
 */
import { config } from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

config({ path: ".env.local", quiet: true });
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const up = URL ? await fetch(`${URL}/auth/v1/health`, { headers: { apikey: ANON ?? "" } }).then((r) => r.ok).catch(() => false) : false;

describe.skipIf(!up)("RLS isolation (live)", () => {
  let eve: SupabaseClient;
  beforeAll(async () => {
    eve = createClient(URL!, ANON!, { auth: { persistSession: false } });
    const { error } = await eve.auth.signInWithPassword({ email: "eve@agentme.test", password: "password123" });
    expect(error).toBeNull();
  });

  it("only sees her own facts", async () => {
    const { data } = await eve.from("agent_facts").select("value");
    expect(data?.map((f) => f.value)).toEqual(["Any evening"]);
  });

  it("cannot read other people's conversations, messages, tasks or exchanges", async () => {
    for (const table of ["messages", "tasks", "proposals"] as const) {
      const { data } = await eve.from(table).select("id");
      // Eve may only see rows from her own conversations/tasks.
      const { data: mine } = await eve.from("conversation_members").select("conversation_id");
      if (table === "messages") {
        const ids = new Set(mine?.map((m) => m.conversation_id));
        const { data: rows } = await eve.from("messages").select("conversation_id");
        expect(rows?.every((r) => ids.has(r.conversation_id))).toBe(true);
      } else {
        expect(data).toEqual([]);
      }
    }
    const { data: exchanges } = await eve.from("task_exchanges").select("from_agent, to_agent, disclosed_categories");
    expect(exchanges?.every((e) => e.disclosed_categories.length === 0)).toBe(true);
  });

  it("cannot write directly, even to her own rows", async () => {
    const { data: agent } = await eve.from("agents").select("id").eq("handle", "eve").single();
    const insertFact = await eve.from("agent_facts").insert({ agent_id: agent!.id, category: "food", value: "x", disclosure: "contacts" });
    expect(insertFact.error).not.toBeNull();
    const update = await eve.from("agents").update({ display_name: "Mallory" }).eq("handle", "marco").select();
    expect(update.data ?? []).toEqual([]);
    const contact = await eve.from("contacts").insert({ requester_agent: agent!.id, addressee_agent: agent!.id, status: "accepted" });
    expect(contact.error).not.toBeNull();
  });
});
