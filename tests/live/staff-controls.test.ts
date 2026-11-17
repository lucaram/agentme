import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dbUp } from "./env";
import { businessStaffFixture } from "../fixtures/business-staff";

describe.skipIf(!dbUp)("per-staff reply and Q&A controls", () => {
  let f: Awaited<ReturnType<typeof businessStaffFixture>>; let staff: Awaited<ReturnType<typeof f.signed>>; let manager: typeof staff;
  beforeEach(async () => {
    f = await businessStaffFixture();
    expect((await f.db.from("business_managers").insert([{ business_agent_id: f.business.agent.id, user_id: f.marco.userId, role: "staff" }, { business_agent_id: f.business.agent.id, user_id: f.paul.userId, role: "manager" }])).error).toBeNull();
    expect((await f.db.from("business_managers").update({ supervisor_id: f.paul.userId }).eq("business_agent_id", f.business.agent.id).eq("user_id", f.marco.userId)).error).toBeNull();
    staff = await f.signed(f.marco, true); manager = await f.signed(f.paul, true);
  });
  afterEach(async () => { await f?.cleanup(); });
  async function settings(assignment: boolean, approval: boolean) { const result = await f.owner.rpc("set_business_staff_controls", { p_user: f.marco.userId, p_require_assignment: assignment, p_require_publication_approval: approval }); expect(result.error).toBeNull(); }
  async function question(eligible = true) {
    const result = await f.db.from("inbox_items").insert({ owner_id: f.business.userId, agent_id: f.business.agent.id, kind: "question", payload: { kind: "question", business: true, faq_eligible: eligible, question: "Do you offer secure cello storage?" } }).select("id").single(); if (result.error) throw result.error; return result.data.id;
  }
  async function publish(id?: string, ticket?: string) { return f.db.rpc("publish_staff_business_answer", { p_business: f.business.agent.id, p_actor: f.marco.userId, p_question: "Do you offer secure cello storage?", p_answer: "We store cellos in a locked room during meals.", p_inbox: id, p_ticket: ticket }); }
  async function faqs() { return ((await f.db.from("agents").select("business_info").eq("id", f.business.agent.id).single()).data!.business_info as { faqs: { q: string; a: string }[] }).faqs; }
  it("defaults to optional assignment and required publication approval; only Owners/Managers can edit Staff", async () => {
    expect((await f.db.from("business_managers").select("require_assignment,require_publication_approval").eq("user_id", f.marco.userId).single()).data).toEqual({ require_assignment: false, require_publication_approval: true });
    const args = { p_user: f.marco.userId, p_require_assignment: true, p_require_publication_approval: false };
    expect((await staff.rpc("set_business_staff_controls", args)).error).toBeTruthy();
    expect((await (await f.signed(f.paul)).rpc("set_business_staff_controls", args)).error).toBeTruthy();
    expect((await manager.rpc("set_business_staff_controls", { ...args, p_user: f.business.userId })).error).toBeTruthy();
    expect((await manager.rpc("set_business_staff_controls", args)).error).toBeNull();
    expect((await staff.from("business_managers").update({ require_publication_approval: false }).eq("user_id", f.marco.userId).select("user_id")).data ?? []).toEqual([]);
    expect((await f.db.from("business_staff_audit").select("action").eq("business_agent_id", f.business.agent.id).like("action", "Staff permissions updated%" )).data).toHaveLength(1);
  });
  it("requires a real Owner/Manager assignment, updates attention and prevents direct-table or self-claim bypasses", async () => {
    await settings(true, true); const id = await question();
    expect((await staff.rpc("claim_business_question", { p_item: id })).error?.message).toMatch(/must assign|requires assignment/);
    expect((await staff.rpc("reserve_business_answer", { p_item: id })).error?.message).toMatch(/must assign|requires assignment/);
    expect((await staff.rpc("owner_attention_count")).data).toBe(0); expect((await staff.rpc("open_owner_requests")).data).toEqual([]);
    const bypass = await staff.from("inbox_items").update({ status: "answered" }).eq("id", id).select("id");
    expect(bypass.data ?? []).toEqual([]);
    expect((await f.db.from("inbox_items").select("status").eq("id", id).single()).data?.status).toBe("open");
    expect((await manager.rpc("claim_business_question", { p_item: id, p_assignee: f.marco.userId })).error).toBeNull();
    expect((await staff.rpc("owner_attention_count")).data).toBe(1); expect((await staff.rpc("open_owner_requests")).data?.map((i) => i.id)).toEqual([id]);
    expect((await staff.rpc("reserve_business_answer", { p_item: id })).error).toBeNull();
  });
  it("does not treat an old self-claim as a Manager assignment when the setting is enabled", async () => {
    const id = await question(); expect((await staff.rpc("claim_business_question", { p_item: id })).error).toBeNull();
    await settings(true, true); expect((await staff.rpc("reserve_business_answer", { p_item: id })).error?.message).toMatch(/must assign|requires assignment/);
    expect((await f.owner.rpc("claim_business_question", { p_item: id, p_assignee: f.marco.userId })).error).toBeNull();
    expect((await staff.rpc("reserve_business_answer", { p_item: id })).error).toBeNull();
  });
  it("keeps both publication commits service-only and enforces live approval requirements", async () => {
    const before = (await faqs()).length;
    expect((await staff.rpc("publish_staff_business_answer", { p_business: f.business.agent.id, p_actor: f.marco.userId, p_question: "Storage?", p_answer: "Yes." })).error?.code).toBe("42501");
    expect((await f.owner.rpc("review_business_answer_as", { p_business: f.business.agent.id, p_actor: f.business.userId, p_draft: crypto.randomUUID(), p_approve: true, p_question: "Storage?", p_answer: "Yes." })).error?.code).toBe("42501");
    expect((await publish()).error?.message).toContain("Approval is now required"); expect((await faqs()).length).toBe(before);
  });
  it("publishes trusted Staff answers once, with an explicit source/lease and no pending approval card", async () => {
    await settings(false, false); const id = await question(); const ticket = await staff.rpc("reserve_business_answer", { p_item: id }); expect(ticket.error).toBeNull();
    expect((await publish(id, crypto.randomUUID())).error).toBeTruthy();
    const first = await publish(id, ticket.data!); expect(first.error).toBeNull(); expect((await publish(id, ticket.data!)).data).toBe(first.data);
    expect((await faqs()).filter((faq) => faq.q === "Do you offer secure cello storage?")).toHaveLength(1);
    expect((await f.db.from("business_answer_drafts").select("status,source_inbox,author_id").eq("id", first.data!).single()).data).toEqual({ status: "approved", source_inbox: id, author_id: f.marco.userId });
    expect((await f.db.from("inbox_items").select("id").eq("owner_id", f.business.userId).eq("kind", "business_answer_review").eq("status", "open")).data).toEqual([]);
  });
  it("rechecks changed policy, scope and membership before committing direct publication", async () => {
    await settings(false, false); const privateId = await question(false); const privateTicket = await staff.rpc("reserve_business_answer", { p_item: privateId });
    expect((await publish(privateId, privateTicket.data!)).error).toBeTruthy();
    const id = await question(); const ticket = await staff.rpc("reserve_business_answer", { p_item: id });
    await settings(false, true); expect((await publish(id, ticket.data!)).error?.message).toContain("Approval is now required");
    await settings(false, false); await f.db.from("business_managers").delete().eq("business_agent_id", f.business.agent.id).eq("user_id", f.marco.userId);
    expect((await publish(id, ticket.data!)).error?.message).toContain("Staff access unavailable");
  });
  it("preserves the edited, coherent FAQ on Manager approval and rejects foreign or demoted reviewers", async () => {
    const suggested = await staff.rpc("suggest_business_answer", { p_question: "Can you store a cello?", p_answer: "We have a purple cello." }); expect(suggested.error).toBeNull();
    const args = { p_business: f.business.agent.id, p_actor: f.marco.userId, p_draft: suggested.data!, p_approve: true, p_question: "Do you offer secure cello storage?", p_answer: "We store cellos in a locked room during meals." };
    expect((await f.db.rpc("review_business_answer_as", args)).error).toBeTruthy();
    expect((await f.db.rpc("review_business_answer_as", { ...args, p_actor: f.paul.userId })).error).toBeNull();
    expect((await f.db.from("business_answer_drafts").select("question,answer,status").eq("id", suggested.data!).single()).data).toEqual({ question: args.p_question, answer: args.p_answer, status: "approved" });
    expect((await faqs()).some((faq) => faq.q === args.p_question && faq.a === args.p_answer)).toBe(true);
  });
});
