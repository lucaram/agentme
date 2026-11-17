import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { dbUp } from "./env";
import { businessStaffFixture } from "../fixtures/business-staff";
import { PresenceOwn, aggregatePresence } from "@/lib/presence/types";
import type { RealtimeChannel } from "@supabase/supabase-js";

describe.skipIf(!dbUp)("business staff workspaces", () => {
  let f: Awaited<ReturnType<typeof businessStaffFixture>>;
  let staff: Awaited<ReturnType<typeof f.signed>>, manager: typeof staff, personal: typeof staff;
  let invitation = "", draft = "", question = "";
  const hash = (v: string) => createHash("sha256").update(`${f.business.agent.id}:${v}`).digest("hex");
  beforeAll(async () => { f = await businessStaffFixture(); personal = await f.signed(f.marco); });
  afterAll(async () => { await f?.cleanup(); });
  it("searches eligible registered people without exposing emails, and rejects email invitations", async () => {
    const found = await f.owner.rpc("search_business_staff", { p_query: `@${f.marco.agent.handle}` }); expect(found.error).toBeNull();
    expect(found.data).toEqual([{ id: f.marco.agent.id, name: "Marco", avatar: f.marco.agent.avatar, handle: f.marco.agent.handle }]);
    expect((await personal.rpc("search_business_staff", { p_query: "marco" })).error).toBeTruthy();
    expect((await f.owner.rpc("search_business_staff", { p_query: f.business.agent.handle })).data).toEqual([]);
    expect((await f.owner.rpc("issue_business_invite", { p_target: f.paul.email, p_role: "staff", p_digest: hash("email") })).error?.message).toContain("registered user");
    await f.db.from("agents").update({ discoverable: false }).eq("id", f.paul.agent.id);
    expect((await f.owner.rpc("search_business_staff", { p_query: "Paul" })).data?.some((person) => person.id === f.paul.agent.id)).toBe(false);
    expect((await f.owner.rpc("search_business_staff", { p_query: `@${f.paul.agent.handle}` })).data?.[0].id).toBe(f.paul.agent.id);
    await f.db.from("agents").update({ discoverable: true }).eq("id", f.paul.agent.id);
    const block = await f.db.from("contacts").insert({ requester_agent: f.business.agent.id, addressee_agent: f.luca.agent.id, status: "blocked", blocked_by: f.business.agent.id }).select("id").single(); expect(block.error).toBeNull();
    expect((await f.owner.rpc("search_business_staff", { p_query: `@${f.luca.agent.handle}` })).data).toEqual([]);
    expect((await f.owner.rpc("issue_business_invite", { p_target: `@${f.luca.agent.handle}`, p_role: "staff", p_digest: hash("blocked") })).error).toBeTruthy();
    await f.db.from("contacts").delete().eq("id", block.data!.id);
  });
  it("binds invitations to verified recipients, requires acceptance and keeps one business identity", async () => {
    const created = await f.owner.rpc("issue_business_invite", { p_target: `@${f.marco.agent.handle}`, p_role: "staff", p_digest: hash("one") }); expect(created.error).toBeNull(); invitation = created.data!;
    expect((await f.owner.rpc("search_business_staff", { p_query: f.marco.agent.handle })).data).toEqual([]);
    expect((await f.db.from("business_managers").select("user_id").eq("business_agent_id", f.business.agent.id)).data).toHaveLength(1);
    const wrong = await f.signed(f.paul); expect((await wrong.rpc("respond_business_invite", { p_invite: invitation, p_accept: true })).error).toBeTruthy();
    expect((await personal.rpc("respond_business_invite", { p_invite: invitation, p_accept: true })).error).toBeNull();
    expect((await personal.rpc("respond_business_invite", { p_invite: invitation, p_accept: true })).error).toBeTruthy();
    staff = await f.signed(f.marco, true);
    expect((await staff.auth.getUser()).data.user?.id).toBe(f.marco.userId);
    expect((await staff.rpc("workspace_context")).data).toMatchObject({ user_id: f.business.userId, actor_id: f.marco.userId, role: "staff", working: true });
    expect((await personal.rpc("workspace_context")).data).toMatchObject({ user_id: f.marco.userId, role: null, working: false });
    expect((await f.owner.rpc("search_business_staff", { p_query: f.marco.agent.handle })).data).toEqual([]);
  });
  it("enforces staff limits on direct database writes, RPCs and business secrets", async () => {
    for (const permission of ["configure", "staff", "ownership"]) expect((await staff.rpc("business_permission", { p_permission: permission })).data).toBe(false);
    expect((await staff.from("agents").update({ display_name: "Escalated" }).eq("id", f.business.agent.id).select("id")).data ?? []).toEqual([]);
    expect((await staff.rpc("issue_business_invite", { p_target: f.paul.email, p_role: "manager", p_digest: hash("bad") })).error).toBeTruthy();
    expect((await staff.rpc("change_business_member", { p_user: f.marco.userId, p_role: "owner" })).error).toBeTruthy();
    expect((await staff.from("business_staff_audit").select("id")).data).toEqual([]);
    expect((await staff.from("business_work_sessions").select("*")).error).toBeTruthy();
    expect((await staff.rpc("business_dashboard", { p_agent: f.business.agent.id, p_days: 30 })).data).toBeNull();
    expect((await f.db.from("agents").select("display_name").eq("id", f.business.agent.id).single()).data?.display_name).toBe("Trattoria Sole");
  });
  it("keeps work presence separate and requires explicit work availability", async () => {
    const own = PresenceOwn.parse((await staff.rpc("presence_self")).data);
    expect(own).toMatchObject({ business: true, participating: false });
    expect((await staff.rpc("presence_channel_access", { p_topic: own.topic, p_write: true })).data).toBe(false);
    expect((await staff.rpc("set_work_participation", { p_available: true })).error).toBeNull();
    const available = PresenceOwn.parse((await staff.rpc("presence_self")).data); expect(available.participating).toBe(true);
    expect((await staff.rpc("presence_channel_access", { p_topic: available.topic, p_write: true })).data).toBe(true);
    expect((await staff.rpc("set_presence_visibility", { p_visibility: "customers" })).error).toBeTruthy();
    expect((await staff.rpc("set_presence_mode", { p_mode: "busy", p_minutes: 60 })).error).toBeNull();
    expect(PresenceOwn.parse((await personal.rpc("presence_self")).data).mode).toBe("auto");
    expect((await staff.rpc("set_presence_mode", { p_mode: "invisible" })).error).toBeNull();
    const hidden = PresenceOwn.parse((await staff.rpc("presence_self")).data);
    expect((await staff.rpc("presence_channel_access", { p_topic: hidden.topic, p_write: true })).data).toBe(false);
  });
  it("keeps suggestions unpublished until authorized approval", async () => {
    const proposed = await staff.rpc("suggest_business_answer", { p_question: "Can we bring bicycles?", p_answer: "We have space for four bicycles." }); expect(proposed.error).toBeNull(); draft = proposed.data!;
    expect((await staff.rpc("suggest_business_answer", { p_question: "Can we bring bicycles?", p_answer: "We have space for four bicycles." })).data).toBe(draft);
    expect((await staff.rpc("open_owner_requests")).data?.some((i) => i.kind === "business_answer_review")).toBe(false);
    expect((await f.owner.rpc("open_owner_requests")).data?.some((i) => i.kind === "business_answer_review")).toBe(true);
    expect((await staff.rpc("owner_attention_count")).data).toBe(0);
    expect((await f.owner.rpc("owner_attention_count")).data).toBe(1);
    expect((await f.db.rpc("identity_staff_badge", { p_user: f.business.userId })).data).toBe(0);
    expect((await staff.rpc("review_business_answer", { p_draft: draft, p_approve: true, p_question: "Bicycles?", p_answer: "Yes" })).error).toBeTruthy();
    // Browser RPCs cannot bypass the application's publication review.
    expect((await f.owner.rpc("review_business_answer", { p_draft: draft, p_approve: true, p_question: "Can we bring bicycles?", p_answer: "We have space for four bicycles." })).error?.code).toBe("42501");
    expect((await f.db.rpc("review_business_answer_as", { p_business: f.business.agent.id, p_actor: f.business.userId, p_draft: draft, p_approve: true, p_question: "Can we bring bicycles?", p_answer: "We have space for four bicycles." })).error).toBeNull();
    const info = (await f.db.from("agents").select("business_info").eq("id", f.business.agent.id).single()).data!.business_info as { faqs: { q: string }[] };
    expect(info.faqs.some((faq) => faq.q === "Can we bring bicycles?")).toBe(true);
  });
  it("aggregates actual team sockets and keeps individual work channels private", async () => {
    await staff.rpc("set_presence_mode", { p_mode: "auto" });
    await f.owner.rpc("set_presence_visibility", { p_visibility: "customers" });
    const own = PresenceOwn.parse((await staff.rpc("presence_self")).data);
    const customer = await f.signed(f.luca);
    for (const client of [f.owner, staff, customer]) await client.realtime.setAuth((await client.auth.getSession()).data.session!.access_token);
    expect((await customer.rpc("presence_channel_access", { p_topic: own.staffTopic!, p_write: false })).data).toBe(false);
    const join = (channel: RealtimeChannel) => new Promise<string>((resolve) => { const timer = setTimeout(() => resolve("TIMEOUT"), 7000); channel.subscribe((status) => { if (["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT"].includes(status)) { clearTimeout(timer); resolve(status); } }); });
    const ownerChannel = f.owner.channel(own.topic, { config: { private: true, presence: { key: "owner", enabled: true } } });
    const staffChannel = staff.channel(own.topic, { config: { private: true, presence: { key: "staff", enabled: true } } });
    const viewer = customer.channel(own.topic, { config: { private: true } }).on("presence", { event: "sync" }, () => {});
    try {
      for (const channel of [ownerChannel, staffChannel, viewer]) expect(await join(channel)).toBe("SUBSCRIBED");
      expect(await ownerChannel.track({ state: "busy" })).toBe("ok"); expect(await staffChannel.track({ state: "online" })).toBe("ok");
      await expect.poll(() => aggregatePresence(Object.values(viewer.presenceState()).flat())).toBe("online");
      await staffChannel.untrack(); await expect.poll(() => aggregatePresence(Object.values(viewer.presenceState()).flat())).toBe("busy");
    } finally { await f.owner.removeChannel(ownerChannel); await staff.removeChannel(staffChannel); await customer.removeChannel(viewer); }
  }, 20_000);
  it("claims once and prevents simultaneous answers, with private actual-human attribution", async () => {
    const item = await f.db.from("inbox_items").insert({ owner_id: f.business.userId, agent_id: f.business.agent.id, kind: "question", payload: { kind: "question", business: true, question: "Bicycle storage?" } }).select("id").single(); expect(item.error).toBeNull(); question = item.data!.id;
    expect((await staff.rpc("claim_business_question", { p_item: question })).error).toBeNull();
    expect((await f.owner.rpc("reserve_business_answer", { p_item: question })).error).toBeTruthy();
    const attempts = await Promise.all([staff.rpc("reserve_business_answer", { p_item: question }), staff.rpc("reserve_business_answer", { p_item: question })]); expect(attempts.filter((a) => !a.error)).toHaveLength(1);
    expect((await staff.from("business_question_claims").select("processing_token")).error).toBeTruthy();
    const posted = await f.db.rpc("post_business_authored_message", { p_actor: f.marco.userId, p_business: f.business.agent.id, p_conversation: f.direct, p_content: "Yes, from our team.", p_metadata: { team_inbox_id: question }, p_user: null, p_agent: f.business.agent.id, p_visible: null, p_thread: null, p_reply: null }); expect(posted.error).toBeNull();
    const repeated = await f.db.rpc("post_business_authored_message", { p_actor: f.marco.userId, p_business: f.business.agent.id, p_conversation: f.direct, p_content: "duplicate", p_metadata: { team_inbox_id: question }, p_user: null, p_agent: f.business.agent.id, p_visible: null, p_thread: null, p_reply: null }); expect(repeated.data?.[0].id).toBe(posted.data?.[0].id);
    expect((await staff.from("business_message_authors").select("actor_id").eq("message_id", posted.data![0].id)).data).toEqual([{ actor_id: f.marco.userId }]);
    const customer = await f.signed(f.luca); expect((await customer.from("business_message_authors").select("actor_id")).data).toEqual([]);
  });
  it("expires, renews and cancels invitations without changing their original recipient", async () => {
    const created = await f.owner.rpc("issue_business_invite", { p_target: `@${f.paul.agent.handle}`, p_role: "staff", p_digest: hash("pending") }); expect(created.error).toBeNull();
    expect((await f.owner.rpc("issue_business_invite", { p_existing: created.data!, p_target: f.luca.email, p_role: "manager", p_digest: hash("renewed") })).error).toBeNull();
    expect((await f.db.from("business_staff_invites").select("email,role,token_hash").eq("id", created.data!).single()).data).toMatchObject({ email: f.paul.email, role: "staff", token_hash: hash("renewed") });
    await f.db.from("business_staff_invites").update({ expires_at: "2020-01-01T00:00:00Z" }).eq("id", created.data!);
    const paul = await f.signed(f.paul); expect((await paul.rpc("respond_business_invite", { p_invite: created.data!, p_accept: true })).error).toBeTruthy();
    expect((await paul.rpc("open_owner_requests")).data?.some((i) => i.kind === "business_invitation")).toBe(false);
    expect((await f.owner.rpc("cancel_business_invite", { p_invite: created.data! })).error).toBeNull();
    expect((await paul.rpc("respond_business_invite", { p_invite: created.data!, p_accept: true })).error).toBeTruthy();
  });
  it("allows managers to manage staff but protects elevated roles and the final owner", async () => {
    const invite = await f.owner.rpc("issue_business_invite", { p_target: `@${f.paul.agent.handle}`, p_role: "manager", p_digest: hash("manager") }); expect(invite.error).toBeNull();
    const paul = await f.signed(f.paul); expect((await paul.rpc("respond_business_invite", { p_invite: invite.data!, p_accept: true })).error).toBeNull(); manager = await f.signed(f.paul, true);
    const move = await f.owner.rpc("request_business_staff_transfer", { p_staff: f.marco.userId, p_target: f.paul.userId }); expect(move.error).toBeNull();
    expect((await manager.rpc("respond_business_staff_transfer", { p_transfer: move.data!, p_decision: "accept" })).error).toBeNull();
    const request = await f.db.from("inbox_items").insert({ owner_id: f.business.userId, agent_id: f.business.agent.id, kind: "question", payload: { kind: "question", business: true, question: "Another general question?" } }).select("id").single(); expect(request.error).toBeNull();
    expect((await manager.rpc("claim_business_question", { p_item: request.data!.id, p_assignee: f.business.userId })).error?.message).toMatch(/Staff member/);
    expect((await manager.rpc("claim_business_question", { p_item: request.data!.id, p_assignee: f.marco.userId })).error).toBeNull();
    expect((await f.owner.rpc("claim_business_question", { p_item: request.data!.id, p_assignee: f.paul.userId })).error).toBeNull();
    expect((await manager.rpc("change_business_member", { p_user: f.marco.userId, p_role: "manager" })).error).toBeTruthy();
    expect((await manager.rpc("change_business_member", { p_user: f.business.userId, p_role: "remove" })).error).toBeTruthy();
    expect((await f.owner.rpc("change_business_member", { p_user: f.business.userId, p_role: "staff" })).error).toBeTruthy();
    expect((await f.owner.rpc("change_business_member", { p_user: f.marco.userId, p_role: "manager" })).error).toBeNull();
    expect((await staff.rpc("workspace_context")).data).toMatchObject({ role: "manager" });
    expect((await f.owner.rpc("change_business_member", { p_user: f.marco.userId, p_role: "staff" })).error).toBeNull();
  });
  it("revokes work sessions immediately without deleting personal identity or unrelated logins", async () => {
    expect((await f.owner.rpc("change_business_member", { p_user: f.marco.userId, p_role: "remove" })).error).toBeNull();
    expect((await staff.rpc("workspace_context")).data).toMatchObject({ user_id: null });
    expect((await staff.from("agents").select("id")).data).toEqual([]);
    expect((await staff.rpc("claim_business_question", { p_item: question })).error).toBeTruthy();
    expect((await personal.rpc("workspace_context")).data).toMatchObject({ user_id: f.marco.userId });
    expect((await f.db.auth.admin.getUserById(f.marco.userId)).data.user).toBeTruthy();
    expect((await manager.rpc("business_permission", { p_permission: "configure" })).data).toBe(true);
  });
  it("transfers ownership atomically and records the actual human decision maker", async () => {
    expect((await f.owner.rpc("change_business_member", { p_user: f.paul.userId, p_role: "owner", p_transfer: true })).error).toBeNull();
    expect((await f.owner.rpc("workspace_context")).data).toMatchObject({ role: "manager" });
    expect((await manager.rpc("workspace_context")).data).toMatchObject({ role: "owner" });
    expect((await f.db.from("business_staff_audit").select("actor_id,action").eq("business_agent_id", f.business.agent.id).eq("action", "Ownership transferred")).data).toEqual([{ actor_id: f.business.userId, action: "Ownership transferred" }]);
    expect((await manager.rpc("change_business_member", { p_user: f.paul.userId, p_role: "remove" })).error).toBeTruthy();
  });
  it("lets an owner leave their own work session when another owner remains", async () => {
    expect((await manager.rpc("change_business_member", { p_user: f.business.userId, p_role: "owner" })).error).toBeNull();
    expect((await manager.rpc("change_business_member", { p_user: f.paul.userId, p_role: "remove" })).error).toBeNull();
    expect((await manager.rpc("workspace_context")).data).toMatchObject({ user_id: null });
    expect((await f.owner.rpc("workspace_context")).data).toMatchObject({ role: "owner" });
  });
});
