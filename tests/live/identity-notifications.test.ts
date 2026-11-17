import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbUp, SUPABASE_URL, ANON_KEY } from "./env";
import { businessStaffFixture } from "../fixtures/business-staff";
import { NotificationState, NotificationCounts } from "@/lib/notifications/types";
import type { Database } from "@/lib/database.types";

describe.skipIf(!dbUp)("identity-scoped notification snapshots", () => {
  let f: Awaited<ReturnType<typeof businessStaffFixture>>;
  beforeEach(async () => { f = await businessStaffFixture(); });
  afterEach(async () => { await f?.cleanup(); });
  async function state(actor = f.marco.userId, current = actor) {
    const result = await f.db.rpc("notification_accounts", { p_actor: actor, p_current: current });
    expect(result.error).toBeNull(); return NotificationState.parse(result.data);
  }
  async function snapshot(user = f.business.userId, role: string | null = "owner", actor = user) {
    const result = await f.db.rpc("notification_snapshot", { p_user: user, p_role: role, p_actor: actor });
    expect(result.error).toBeNull(); return NotificationCounts.parse(result.data);
  }
  async function join(person = f.marco, role = "manager") {
    expect((await f.db.from("business_managers").insert({ business_agent_id: f.business.agent.id, user_id: person.userId, role })).error).toBeNull();
  }
  async function question(kind = "question") {
    let draft: string | undefined;
    if (kind === "business_answer_review") {
      const result = await f.db.from("business_answer_drafts").insert({ business_agent_id: f.business.agent.id, author_id: f.marco.userId, author_name: "Marco", question: "Can you store a cello?", answer: "We offer secure storage." }).select("id").single(); if (result.error) throw result.error; draft = result.data.id;
    }
    const result = await f.db.from("inbox_items").insert({ owner_id: f.business.userId, agent_id: f.business.agent.id, kind, payload: { business: true, question: "Can you store a cello?", ...(draft ? { draft_id: draft } : {}) } }).select("id").single();
    if (result.error) throw result.error; return result.data!.id;
  }
  async function home(person = f.business) {
    const result = await f.db.from("conversations").insert({ kind: "my_agent", created_by: person.userId }).select("id").single(); if (result.error) throw result.error;
    expect((await f.db.from("conversation_members").insert({ conversation_id: result.data!.id, user_id: person.userId, role: "owner" })).error).toBeNull(); return result.data!.id;
  }
  async function message(extra: Partial<Database["public"]["Tables"]["messages"]["Insert"]> = {}) {
    const result = await f.db.from("messages").insert({ conversation_id: f.group, sender_user_id: f.luca.userId, content: "Notification test", is_ai_generated: Boolean(extra.sender_agent_id), ...extra }).select("id").single(); if (result.error) throw result.error; return result.data!.id;
  }
  it("keeps personal-only, managed-owner, staff and standalone-business counts separate", async () => {
    await message(); await question(); await question(); await question("business_answer_review");
    expect((await state()).accounts).toMatchObject([{ current: true, ownerId: f.marco.userId, notifications: { total: 1, chats: 1, attention: 0 } }]);
    await join(); await join(f.paul, "staff");
    const personal = await state(); expect(personal.accounts).toHaveLength(2);
    expect(personal.accounts.find((a) => a.current)?.notifications.total).toBe(1);
    expect(personal.accounts.find((a) => a.type === "business")).toMatchObject({ current: false, role: "manager", notifications: { total: 3, attention: 3 } });
    const working = await state(f.marco.userId, f.business.userId);
    expect(working.accounts.find((a) => a.current)?.notifications.total).toBe(3);
    expect(working.accounts.find((a) => a.type === "personal")?.notifications.total).toBe(1);
    expect((await state(f.paul.userId)).accounts.find((a) => a.type === "business")).toMatchObject({ role: "staff", notifications: { total: 2, attention: 2, groups: 0 } });
    await f.db.from("business_managers").update({ role: "owner" }).eq("user_id", f.marco.userId);
    expect((await state()).accounts.find((a) => a.type === "business")).toMatchObject({ role: "owner", notifications: { total: 3 } });
    await f.db.from("business_managers").delete().eq("business_agent_id", f.business.agent.id);
    expect((await state(f.business.userId)).accounts).toMatchObject([{ current: true, ownerId: f.business.userId, notifications: { total: 3 } }]);
  });
  it("uses individual views, visibility and deletion rules rather than raw message totals", async () => {
    const first = await message(); const second = await message();
    await message({ visible_to: f.luca.userId }); await message({ removed_at: new Date().toISOString() }); await message({ deleted_at: new Date().toISOString(), removed_at: new Date().toISOString() });
    expect((await snapshot(f.marco.userId, null)).chats).toBe(2);
    const personal = await f.signed(f.marco);
    expect((await personal.rpc("acknowledge_messages", { p_ids: [second], p_seen: false })).error).toBeNull();
    expect((await snapshot(f.marco.userId, null)).chats).toBe(2);
    expect((await personal.rpc("acknowledge_messages", { p_ids: [second], p_seen: true })).error).toBeNull();
    expect((await snapshot(f.marco.userId, null)).chats).toBe(1);
    expect((await personal.rpc("unread_counts")).data).toMatchObject([{ conversation_id: f.group, unread: 1 }]);
    await personal.rpc("acknowledge_messages", { p_ids: [first], p_seen: true });
    expect((await snapshot(f.marco.userId, null)).total).toBe(0);
  });
  it("counts a linked request once and does not clear pending work when its note is read", async () => {
    const conversation = await home(); const inbox = await question();
    await message({ conversation_id: conversation, sender_user_id: null, sender_agent_id: f.business.agent.id, metadata: { kind: "request_note", inbox_item_id: inbox } });
    const note = await f.db.from("messages").select("id").eq("conversation_id", conversation).single();
    expect((await snapshot()).total).toBe(1);
    const viewed = await f.owner.rpc("acknowledge_messages", { p_ids: [note.data!.id], p_seen: true }); expect(viewed.error).toBeNull();
    expect((await snapshot()).total).toBe(1);
    const page = await f.owner.rpc("my_agent_topic_page", { p_conversation: conversation }); expect(page.error).toBeNull();
    expect((page.data as { items: { unread: number }[] }).items.every((t) => t.unread === 0)).toBe(true);
    expect((await f.db.from("inbox_items").update({ status: "answered" }).eq("id", inbox)).error).toBeNull();
    expect((await snapshot()).total).toBe(0);
  });
  it("adds distinct unread topics to actionable work and respects mute", async () => {
    const conversation = await home(); await question();
    const thread = await f.db.from("agent_threads").insert({ conversation_id: conversation, owner_id: f.business.userId, title: "Different update" }).select("id").single(); expect(thread.error).toBeNull();
    await message({ conversation_id: conversation, thread_id: thread.data!.id, sender_user_id: null, sender_agent_id: f.business.agent.id });
    await message({ conversation_id: conversation, thread_id: thread.data!.id, sender_user_id: null, sender_agent_id: f.business.agent.id });
    expect(await snapshot()).toMatchObject({ total: 2, chats: 2, attention: 1 });
    await f.db.from("conversation_members").update({ muted: true }).eq("conversation_id", conversation);
    expect(await snapshot()).toMatchObject({ total: 0, attention: 1, unread: [{ unread: 2, muted: true }] });
  });
  it("counts a group invitation once across My Agent and Groups and excludes expired invitations", async () => {
    await f.db.from("conversation_members").delete().eq("conversation_id", f.group).eq("user_id", f.marco.userId);
    const inbox = await f.db.from("inbox_items").insert({ owner_id: f.marco.userId, agent_id: f.marco.agent.id, from_agent: f.luca.agent.id, kind: "group_invite", payload: { conversation_id: f.group } }).select("id").single(); expect(inbox.error).toBeNull();
    expect(await snapshot(f.marco.userId, null)).toMatchObject({ total: 1, groups: 1, chats: 1, attention: 1 });
    await home(f.marco);
    expect(await snapshot(f.marco.userId, null)).toMatchObject({ total: 1, groups: 1, chats: 1 });
    await f.db.from("inbox_items").update({ created_at: new Date(Date.now() - 8 * 86400000).toISOString() }).eq("id", inbox.data!.id);
    expect(await snapshot(f.marco.userId, null)).toMatchObject({ total: 0, attention: 0, groups: 0 });
  });
  it("matches selected-workspace RPCs, applies role changes and removes revoked businesses", async () => {
    await home(); await join(); await question(); await question("business_answer_review");
    const work = await f.signed(f.marco, true);
    expect((await work.rpc("owner_attention_count")).data).toBe(2);
    expect((await work.rpc("unread_counts")).data).toMatchObject([{ unread: 2 }]);
    await f.db.from("business_managers").update({ role: "staff" }).eq("user_id", f.marco.userId);
    expect((await work.rpc("owner_attention_count")).data).toBe(1);
    expect((await state()).accounts.find((a) => a.type === "business")?.notifications.attention).toBe(1);
    await f.db.from("business_managers").delete().eq("user_id", f.marco.userId);
    expect((await state()).accounts).toHaveLength(1);
    expect((await f.db.rpc("notification_accounts", { p_actor: f.marco.userId, p_current: f.business.userId })).error).toBeTruthy();
    expect((await work.rpc("unread_counts")).data).toEqual([]);
  });
  it("publishes only the real person's own revision and refreshes inactive business changes", async () => {
    await join(); const personal = await f.signed(f.marco);
    const revision = async () => Number((await personal.from("identity_notification_versions").select("revision").eq("user_id", f.marco.userId).single()).data!.revision);
    const before = await revision(); await question(); expect(await revision()).toBeGreaterThan(before);
    expect((await personal.from("inbox_items").select("id").eq("owner_id", f.business.userId)).data).toEqual([]);
    expect((await personal.from("identity_notification_versions").select("*").neq("user_id", f.marco.userId)).data).toEqual([]);
    expect((await personal.from("identity_notification_versions").update({ revision: 0 }).eq("user_id", f.marco.userId)).error?.code).toBe("42501");
    const work = await f.signed(f.marco, true);
    expect((await work.from("identity_notification_versions").select("user_id")).data).toEqual([{ user_id: f.marco.userId }]);
  });
  it("invalidates old/private audiences and expired staff invitations without exposing other people's revisions", async () => {
    const personal = await f.signed(f.marco);
    const revision = async () => Number((await personal.from("identity_notification_versions").select("revision").eq("user_id", f.marco.userId).single()).data!.revision);
    const id = await message({ visible_to: f.marco.userId }); const before = await revision();
    expect((await snapshot(f.marco.userId, null)).total).toBe(1);
    expect((await f.db.from("messages").update({ visible_to: f.paul.userId }).eq("id", id)).error).toBeNull();
    expect(await revision()).toBeGreaterThan(before); expect((await snapshot(f.marco.userId, null)).total).toBe(0);
    expect((await snapshot(f.paul.userId, null)).total).toBe(1);
    const made = await f.owner.rpc("issue_business_invite", { p_target: `@${f.marco.agent.handle}`, p_role: "staff", p_digest: "a".repeat(64) }); expect(made.error).toBeNull();
    expect((await snapshot(f.marco.userId, null)).attention).toBe(1); const invited = await revision();
    expect((await f.db.from("business_staff_invites").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", made.data!)).error).toBeNull();
    expect(await revision()).toBeGreaterThan(invited); expect((await snapshot(f.marco.userId, null)).attention).toBe(0);
  });
  it("scopes Contacts, Groups and Communities actions and their clearing to the selected identity", async () => {
    await join(); await question();
    expect((await f.db.from("contacts").insert([{ requester_agent: f.luca.agent.id, addressee_agent: f.marco.agent.id, status: "pending" }, { requester_agent: f.paul.agent.id, addressee_agent: f.business.agent.id, status: "pending" }])).error).toBeNull();
    expect((await f.db.from("conversation_members").update({ role: "admin" }).eq("conversation_id", f.group).eq("user_id", f.marco.userId)).error).toBeNull();
    expect((await f.db.from("join_requests").insert({ conversation_id: f.group, user_id: f.business.userId })).error).toBeNull();
    expect((await f.db.from("notices").insert([{ user_id: f.marco.userId, area: "communities", text: "Personal update" }, { user_id: f.business.userId, area: "groups", text: "Business update" }])).error).toBeNull();
    const personal = await f.signed(f.marco); const work = await f.signed(f.marco, true);
    expect(await snapshot(f.marco.userId, null)).toMatchObject({ total: 3, chats: 0, contacts: 1, groups: 1, communities: 1 });
    expect(await snapshot()).toMatchObject({ total: 3, chats: 1, contacts: 1, groups: 1, communities: 0 });
    expect((await personal.rpc("action_counts")).data).toEqual([{ contacts: 1, groups: 1, communities: 1 }]);
    expect((await work.rpc("action_counts")).data).toEqual([{ contacts: 1, groups: 1, communities: 0 }]);
    expect((await work.rpc("mark_notices_seen", { p_area: "groups" })).error).toBeNull();
    expect((await state()).accounts.find((a) => a.type === "business")?.notifications.groups).toBe(0);
    expect((await state()).accounts.find((a) => a.current)?.notifications.total).toBe(3);
  });
  it("denies public arbitrary-identity counts and private helper invocation", async () => {
    const clients = [await f.signed(f.marco), createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })];
    for (const client of clients) {
      expect((await client.rpc("notification_accounts", { p_actor: f.luca.userId, p_current: f.luca.userId })).error?.code).toBe("42501");
      expect((await client.rpc("notification_snapshot", { p_user: f.business.userId, p_role: "owner", p_actor: f.marco.userId })).error?.code).toBe("42501");
      for (const name of ["notification_attention", "notification_unread", "notification_action_base", "notification_attention_base"]) {
        const untyped = client as unknown as { rpc: (name: string, args: object) => Promise<{ error: { code: string } | null }> };
        const args = name.endsWith("_base") ? { p_scope_user: f.business.userId, p_scope_role: "owner", p_scope_actor: f.marco.userId } : { p_user: f.business.userId, p_role: "owner", p_actor: f.marco.userId };
        expect((await untyped.rpc(name, args)).error?.code).toBe("42501");
      }
    }
  });
});
