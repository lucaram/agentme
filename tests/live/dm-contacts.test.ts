/**
 * Direct messages are for contacts: removing or blocking closes the chat
 * (readable, but no more sending); reconnecting reopens it. Throwaway users.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, dbUp } from "./env";

const run = Math.random().toString(36).slice(2, 7);
const people = {} as Record<"a" | "b", { userId: string; agentId: string }>;
let dm = "";
let contactId = "";

describe.skipIf(!dbUp)("direct messages need contacts (live)", () => {
  beforeAll(async () => {
    const db = admin();
    for (const k of ["a", "b"] as const) {
      const handle = `tm${run}_${k}`;
      const { data: created, error } = await db.auth.admin.createUser({ email: `${handle}@dm.test`, password: "dm-test-password", email_confirm: true });
      if (error) throw error;
      const { data: agent } = await db.from("agents").insert({ owner_id: created.user.id, handle, display_name: `Test ${k}`, avatar: "🦊" }).select("id").single();
      people[k] = { userId: created.user.id, agentId: agent!.id };
    }
    contactId = (await db.from("contacts").insert({ requester_agent: people.a.agentId, addressee_agent: people.b.agentId, status: "accepted" }).select("id").single()).data!.id;
    const { createConversation } = await import("@/lib/data/chat");
    dm = (await createConversation({ kind: "dm", createdBy: people.a.userId, memberIds: [people.b.userId] })).id;
  });

  afterAll(async () => {
    const db = admin();
    const ids = Object.values(people).map((p) => p.userId);
    await db.from("conversations").delete().in("created_by", ids);
    for (const id of ids) await db.auth.admin.deleteUser(id);
  });

  const state = async (k: "a" | "b") => (await (await import("@/lib/people/dm")).dmState(dm, people[k].userId, people[k].agentId)).state;

  it("open while contacts; closed for both once removed; reopened when they reconnect", async () => {
    expect(await state("a")).toBe("open");
    await admin().from("contacts").delete().eq("id", contactId);
    expect(await state("a")).toBe("removed");
    expect(await state("b")).toBe("removed");
    contactId = (await admin().from("contacts").insert({ requester_agent: people.b.agentId, addressee_agent: people.a.agentId, status: "accepted" }).select("id").single()).data!.id;
    expect(await state("a")).toBe("open");
  });

  it("blocked closes it for both, without saying “blocked” to the blocked person", async () => {
    const { DM_CLOSED } = await import("@/lib/people/dm");
    await admin().from("contacts").update({ status: "blocked", blocked_by: people.b.agentId }).eq("id", contactId);
    expect(await state("a")).toBe("blocked");
    expect(await state("b")).toBe("blocked");
    expect(DM_CLOSED.blocked).not.toMatch(/block/i);
  });

  it("the other person leaving still reads as left", async () => {
    await admin().from("conversation_members").delete().eq("conversation_id", dm).eq("user_id", people.b.userId);
    expect(await state("a")).toBe("left");
  });
});
