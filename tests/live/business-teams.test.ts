import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dbUp } from "./env";
import { businessTeamsFixture } from "../fixtures/business-teams";
import { TeamDashboardData, TeamOptions, TeamState } from "@/lib/business/team-types";

describe.skipIf(!dbUp)("business reporting lines and team isolation", () => {
  let f: Awaited<ReturnType<typeof businessTeamsFixture>>;
  beforeEach(async () => { f = await businessTeamsFixture(); });
  afterEach(async () => { await f?.cleanup(); });
  const assertOk = <T,>(result: { data: T; error: unknown }) => { expect(result.error).toBeNull(); return result.data!; };
  async function supervisor() { return assertOk(await f.db.from("business_managers").select("supervisor_id").eq("business_agent_id", f.business.agent.id).eq("user_id", f.luca.userId).single())!.supervisor_id; }
  async function request(client = f.manager1) { return assertOk(await client.rpc("request_business_staff_transfer", { p_staff: f.luca.userId, p_target: f.paul.userId }))!; }
  async function accept(id: string) { assertOk(await f.manager2.rpc("respond_business_staff_transfer", { p_transfer: id, p_decision: "accept" })); }
  async function question() { return assertOk(await f.db.from("inbox_items").insert({ owner_id: f.business.userId, agent_id: f.business.agent.id, kind: "question", payload: { kind: "question", business: true, question: "Do you offer secure storage?" } }).select("id").single())!.id; }
  async function answer(id: string) {
    assertOk(await f.worker.rpc("reserve_business_answer", { p_item: id }));
    assertOk(await f.db.from("inbox_items").update({ status: "answered", answered_at: new Date().toISOString() }).eq("id", id));
    assertOk(await f.db.from("business_question_claims").update({ handled_by: f.luca.userId, handled_at: new Date().toISOString(), processing_token: null }).eq("inbox_id", id));
  }
  async function dashboard(client = f.owner, scope = "all", person?: string) { return TeamDashboardData.parse(assertOk(await client.rpc("business_team_dashboard", { p_days: 30, p_scope: scope, p_person: person }))); }

  it("requires the receiving supervisor's consent and delivers notices only to their actual work identity", async () => {
    expect(await supervisor()).toBe(f.marco.userId); const id = await request();
    expect(await supervisor()).toBe(f.marco.userId);
    for (const client of [f.owner, f.manager1, f.worker, await f.signed(f.paul)]) expect((await client.rpc("respond_business_staff_transfer", { p_transfer: id, p_decision: "accept" })).error).toBeTruthy();
    const incoming = assertOk(await f.manager2.rpc("business_work_inbox")) as { kind: string; transfer_id: string }[];
    expect(incoming.filter((n) => n.kind === "transfer_request").map((n) => n.transfer_id)).toEqual([id]);
    expect((assertOk(await f.owner.rpc("business_work_inbox")) as unknown[])).toEqual([]);
    expect(assertOk(await (await f.signed(f.paul)).from("business_work_notices").select("id"))).toEqual([]);
    expect(assertOk(await f.manager2.from("business_work_notices").select("recipient_id")).every((n) => n.recipient_id === f.paul.userId)).toBe(true);
    expect((await f.manager1.rpc("request_business_staff_transfer", { p_staff: f.luca.userId, p_target: f.paul.userId })).error).toBeTruthy();
    await accept(id); expect(await supervisor()).toBe(f.paul.userId);
    expect((assertOk(await f.worker.rpc("business_work_inbox")) as { text: string }[]).some((n) => n.text.includes("now reports to Paul"))).toBe(true);
    expect((assertOk(await f.manager1.rpc("business_work_inbox")) as unknown[])).toHaveLength(1);
    expect((assertOk(await f.manager2.rpc("business_work_inbox")) as unknown[])).toEqual([]);
    expect((await f.worker.rpc("respond_business_staff_transfer", { p_transfer: id, p_decision: "accept" })).error).toBeTruthy();
    assertOk(await f.manager2.rpc("respond_business_staff_transfer", { p_transfer: id, p_decision: "accept" }));
  });

  it("supports Owner requests, decline, cancel and expiry without prematurely moving Staff", async () => {
    let id = await request(f.owner); assertOk(await f.manager2.rpc("respond_business_staff_transfer", { p_transfer: id, p_decision: "decline" }));
    expect(await supervisor()).toBe(f.marco.userId);
    id = await request(); assertOk(await f.manager1.rpc("respond_business_staff_transfer", { p_transfer: id, p_decision: "cancel" }));
    id = await request(); assertOk(await f.db.from("business_team_transfers").update({ expires_at: "2020-01-01T00:00:00Z" }).eq("id", id));
    TeamState.parse(assertOk(await f.owner.rpc("business_team_state")));
    expect(assertOk(await f.db.from("business_team_transfers").select("status").eq("id", id).single())!.status).toBe("expired");
    expect(await supervisor()).toBe(f.marco.userId);
    expect((await f.manager2.rpc("request_business_staff_transfer", { p_staff: f.luca.userId, p_target: f.business.userId })).error).toBeTruthy();
    expect((await f.owner.rpc("request_business_staff_transfer", { p_staff: f.luca.userId, p_target: crypto.randomUUID() })).error).toBeTruthy();
  });

  it("keeps assignment and pending FAQ oversight with the current reporting line", async () => {
    const id = await question(); assertOk(await f.manager1.rpc("claim_business_question", { p_item: id, p_assignee: f.luca.userId }));
    const draft = assertOk(await f.worker.rpc("suggest_business_answer", { p_question: "Do you offer storage?", p_answer: "We offer locked indoor storage." }))!;
    expect(assertOk(await f.manager1.from("business_answer_drafts").select("id").eq("id", draft))).toHaveLength(1);
    expect(assertOk(await f.manager2.from("business_answer_drafts").select("id").eq("id", draft))).toEqual([]);
    expect(assertOk(await f.manager2.from("inbox_items").select("id").eq("id", id))).toEqual([]);
    expect((await f.manager2.rpc("claim_business_question", { p_item: id, p_assignee: f.eve.userId })).error).toBeTruthy();
    await accept(await request());
    expect(assertOk(await f.manager1.from("business_answer_drafts").select("id").eq("id", draft))).toEqual([]);
    expect(assertOk(await f.manager2.from("business_answer_drafts").select("id").eq("id", draft))).toHaveLength(1);
    expect(assertOk(await f.manager1.from("inbox_items").select("id").eq("id", id))).toEqual([]);
    expect(assertOk(await f.manager2.from("inbox_items").select("id").eq("id", id))).toHaveLength(1);
    expect(assertOk(await f.db.from("business_question_claims").select("assigned_to").eq("inbox_id", id).single())!.assigned_to).toBe(f.luca.userId);
    const args = { p_business: f.business.agent.id, p_draft: draft, p_approve: true, p_question: "Do you offer storage?", p_answer: "We offer locked indoor storage." };
    expect((await f.db.rpc("review_business_answer_as", { ...args, p_actor: f.marco.userId })).error).toBeTruthy();
    assertOk(await f.db.rpc("review_business_answer_as", { ...args, p_actor: f.paul.userId }));
  });

  it("enforces team boundaries for Staff controls, delegation and private customer notes", async () => {
    expect((await f.manager2.rpc("set_business_staff_controls", { p_user: f.luca.userId, p_require_assignment: true, p_require_publication_approval: true })).error).toBeTruthy();
    expect((await f.manager2.rpc("change_business_member", { p_user: f.luca.userId, p_role: "remove" })).error).toBeTruthy();
    const id = await question(); expect((await f.manager1.rpc("claim_business_question", { p_item: id, p_assignee: f.eve.userId })).error).toBeTruthy();
    assertOk(await f.manager1.rpc("claim_business_question", { p_item: id, p_assignee: f.luca.userId }));
    const thread = assertOk(await f.db.from("agent_threads").insert({ owner_id: f.business.userId, conversation_id: f.businessChat, title: "Private customer request" }).select("id").single())!.id;
    const note = assertOk(await f.db.from("messages").insert({ conversation_id: f.businessChat, sender_agent_id: f.business.agent.id, is_ai_generated: true, thread_id: thread, content: "Private request details", metadata: { kind: "request_note", inbox_item_id: id } }).select("id").single())!.id;
    expect(assertOk(await f.manager1.rpc("can_read_chat_message", { p_user: f.business.userId, p_message: note }))).toBe(true);
    expect(assertOk(await f.manager2.rpc("can_read_chat_message", { p_user: f.business.userId, p_message: note }))).toBe(false);
    expect(assertOk(await f.manager2.from("messages").select("id").eq("id", note))).toEqual([]);
    await accept(await request());
    expect(assertOk(await f.manager1.rpc("can_read_chat_message", { p_user: f.business.userId, p_message: note }))).toBe(false);
    expect(assertOk(await f.manager2.rpc("can_read_chat_message", { p_user: f.business.userId, p_message: note }))).toBe(true);
  });

  it("automatically reparents Staff and cancels stale transfers when their Manager is removed", async () => {
    const questionId = await question(); assertOk(await f.manager1.rpc("claim_business_question", { p_item: questionId, p_assignee: f.luca.userId }));
    const id = await request(); assertOk(await f.owner.rpc("change_business_member", { p_user: f.marco.userId, p_role: "remove" }));
    expect(await supervisor()).toBe(f.business.userId);
    expect(assertOk(await f.db.from("business_team_transfers").select("status").eq("id", id).single())!.status).toBe("cancelled");
    expect(assertOk(await f.db.from("business_question_claims").select("assigned_to").eq("inbox_id", questionId).single())!.assigned_to).toBe(f.luca.userId);
    expect(assertOk(await f.worker.rpc("business_work_inbox"))).toBeTruthy();
    expect((await f.manager1.rpc("workspace_context")).data).toMatchObject({ user_id: null });
    expect((await (await f.signed(f.marco)).rpc("workspace_context")).data).toMatchObject({ user_id: f.marco.userId });
  });

  it("uses the configured receiving Owner for supervisor demotion", async () => {
    assertOk(await f.owner.rpc("change_business_member", { p_user: f.paul.userId, p_role: "owner" }));
    assertOk(await f.owner.rpc("set_business_default_owner", { p_owner: f.paul.userId }));
    assertOk(await f.owner.rpc("change_business_member", { p_user: f.marco.userId, p_role: "staff" }));
    expect(await supervisor()).toBe(f.paul.userId);
    expect(assertOk(await f.db.from("business_managers").select("supervisor_id").eq("user_id", f.marco.userId).single())!.supervisor_id).toBe(f.paul.userId);
    expect((await f.worker.rpc("set_business_default_owner", { p_owner: f.luca.userId })).error).toBeTruthy();
  });

  it("keeps historical work in its original team while pending work follows the current team", async () => {
    const first = await question(); assertOk(await f.manager1.rpc("claim_business_question", { p_item: first, p_assignee: f.luca.userId })); await answer(first);
    expect((await dashboard(f.manager1, "team", f.marco.userId)).summary.answered).toBe(1);
    await accept(await request());
    const next = await question(); assertOk(await f.manager2.rpc("claim_business_question", { p_item: next, p_assignee: f.luca.userId }));
    expect((await dashboard(f.manager1, "team", f.marco.userId)).pending).toBe(0);
    expect((await dashboard(f.manager2, "team", f.paul.userId)).pending).toBe(1); await answer(next);
    expect((await dashboard()).summary.answered).toBe(2);
    expect((await dashboard(f.manager1, "team", f.marco.userId)).summary.answered).toBe(1);
    expect((await dashboard(f.manager2, "person", f.luca.userId)).summary.answered).toBe(1);
    const events = assertOk(await f.db.from("business_work_events").select("supervisor_id").eq("business_agent_id", f.business.agent.id).eq("kind", "answered"));
    expect(events.map((e) => e.supervisor_id).sort()).toEqual([f.marco.userId, f.paul.userId].sort());
  });

  it("rejects unauthorized dashboard scopes and leaves legacy work unattributed", async () => {
    const options = TeamOptions.parse(assertOk(await f.manager1.rpc("business_team_dashboard_options")));
    expect(options.teams.map((p) => p.id)).toEqual([f.marco.userId]); expect(options.people.map((p) => p.id)).toEqual([f.luca.userId]);
    for (const args of [{ p_scope: "all" }, { p_scope: "team", p_person: f.paul.userId }, { p_scope: "person", p_person: f.eve.userId }]) expect((await f.manager1.rpc("business_team_dashboard", args)).error).toBeTruthy();
    expect((await f.worker.rpc("business_team_dashboard_options")).error).toBeTruthy();
    expect((await f.manager1.rpc("business_dashboard", { p_agent: f.business.agent.id, p_days: 30 })).data).toBeNull();
    const id = await question(); assertOk(await f.db.from("inbox_items").update({ status: "answered", answered_at: new Date().toISOString() }).eq("id", id));
    expect((await dashboard()).unattributed).toBe(1);
    expect((await f.manager1.from("business_work_events").select("id")).error).toBeTruthy();
    expect((await f.owner.from("business_team_transfers").update({ status: "accepted" }).eq("staff_id", f.luca.userId)).error).toBeTruthy();
    expect((await f.owner.rpc("record_business_work_event" as never, {} as never)).error).toBeTruthy();
  });

  it("keeps transfer alerts separate for each person and selected business, and scopes actionable counts", async () => {
    const snapshot = async (actor: string, role: string) => assertOk(await f.db.rpc("notification_snapshot", { p_user: f.business.userId, p_actor: actor, p_role: role })) as { attention: number };
    const id = await question(); assertOk(await f.manager1.rpc("claim_business_question", { p_item: id, p_assignee: f.luca.userId }));
    expect((await snapshot(f.marco.userId, "manager")).attention).toBe(1); expect((await snapshot(f.paul.userId, "manager")).attention).toBe(0);
    const move = await request();
    expect((await snapshot(f.marco.userId, "manager")).attention).toBe(2); expect((await snapshot(f.paul.userId, "manager")).attention).toBe(1);
    const personal = assertOk(await f.db.rpc("notification_accounts", { p_actor: f.paul.userId, p_current: f.paul.userId })) as { accounts: { type: string; notifications: { attention: number } }[] };
    expect(personal.accounts.find((a) => a.type === "personal")!.notifications.attention).toBe(0); expect(personal.accounts.find((a) => a.type === "business")!.notifications.attention).toBe(1);
    await accept(move);
    expect((await snapshot(f.marco.userId, "manager")).attention).toBe(1); expect((await snapshot(f.paul.userId, "manager")).attention).toBe(1);
    const notice = (assertOk(await f.manager1.rpc("business_work_inbox")) as { id: string }[])[0];
    assertOk(await f.manager2.rpc("acknowledge_business_work_notice", { p_notice: notice.id }));
    expect(assertOk(await f.db.from("business_work_notices").select("seen_at").eq("id", notice.id).single()).seen_at).toBeNull();
    assertOk(await f.manager1.rpc("acknowledge_business_work_notice", { p_notice: notice.id })); expect((await snapshot(f.marco.userId, "manager")).attention).toBe(0);
  });

  it("records Q&A credit at publication time and retains historical results after membership removal", async () => {
    const draft = assertOk(await f.worker.rpc("suggest_business_answer", { p_question: "Do you offer storage?", p_answer: "We offer locked indoor storage." }))!;
    await accept(await request());
    assertOk(await f.db.rpc("review_business_answer_as", { p_business: f.business.agent.id, p_actor: f.paul.userId, p_draft: draft, p_approve: true, p_question: "Do you offer storage?", p_answer: "We offer locked indoor storage." }));
    expect((await dashboard(f.manager1, "team", f.marco.userId)).summary.published).toBe(0); expect((await dashboard(f.manager2, "team", f.paul.userId)).summary.published).toBe(1);
    assertOk(await f.owner.rpc("change_business_member", { p_user: f.luca.userId, p_role: "remove" }));
    expect((await dashboard(f.owner, "person", f.luca.userId)).summary.published).toBe(1);
    expect(TeamOptions.parse(assertOk(await f.owner.rpc("business_team_dashboard_options"))).people.find((p) => p.id === f.luca.userId)?.former).toBe(true);
    expect((await f.manager2.rpc("business_team_dashboard", { p_scope: "person", p_person: f.luca.userId })).error).toBeTruthy();
  });

  it("prevents another Manager from taking over a pending staff invitation", async () => {
    assertOk(await f.owner.rpc("change_business_member", { p_user: f.eve.userId, p_role: "remove" }));
    const invite = assertOk(await f.manager1.rpc("issue_business_invite", { p_target: `@${f.eve.agent.handle}`, p_role: "staff", p_digest: "a".repeat(64) }));
    expect((await f.manager2.rpc("cancel_business_invite", { p_invite: invite })).error).toBeTruthy();
    expect((await f.manager2.rpc("issue_business_invite", { p_target: "", p_role: "staff", p_digest: "b".repeat(64), p_existing: invite })).error).toBeTruthy();
    assertOk(await (await f.signed(f.eve)).rpc("respond_business_invite", { p_invite: invite, p_accept: true }));
    expect(assertOk(await f.db.from("business_managers").select("supervisor_id").eq("business_agent_id", f.business.agent.id).eq("user_id", f.eve.userId).single()).supervisor_id).toBe(f.marco.userId);
  });
});
