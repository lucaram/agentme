import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, dbUp, SUPABASE_URL } from "./env";
import { planBusinessFixture } from "../fixtures/plan-business";
import { createCommunity, joinCommunity } from "@/lib/social/communities";
import { reportMessage, canPost } from "@/lib/social/shared";
import { OwnReport } from "@/lib/moderation/types";
import { GET } from "@/app/api/reports/evidence/route";
import type { Database } from "@/lib/database.types";

const session = vi.hoisted(() => ({ user: null as { id: string } | null, client: null as unknown }));
vi.mock("@/lib/auth", () => ({ getUser: async () => session.user }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));

describe.skipIf(!dbUp)("private platform moderation", () => {
  let f: Awaited<ReturnType<typeof planBusinessFixture>>; const cases = new Set<string>(); const communities: string[] = [];
  const clients: Record<string, ReturnType<typeof createClient<Database>>> = {};
  beforeAll(async () => {
    f = await planBusinessFixture();
    for (const [key, person] of Object.entries({ luca: f.luca, marco: f.marco, paul: f.paul, business: f.business })) {
      const client = createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
      const { error } = await client.auth.signInWithPassword({ email: person.email, password: f.password }); if (error) throw error; clients[key] = client;
    }
    // This role exists only on the throwaway reviewer account; real accounts stay unassigned.
    expect((await f.db.from("platform_moderators").insert({ user_id: f.paul.userId })).error).toBeNull();
  });
  beforeEach(async () => { if (f) await f.db.from("rate_limits").delete().eq("key", `platformReports:${f.marco.userId}`); });
  afterAll(async () => {
    if (!f) return;
    if (cases.size) await f.db.from("platform_cases").delete().in("id", [...cases]);
    if (communities.length) await f.db.from("communities").delete().in("id", communities);
    await f.cleanup();
  });
  async function message(group: string, content: string, extra = {}) {
    const { data, error } = await f.db.from("messages").insert({ conversation_id: group, sender_user_id: f.luca.userId, is_ai_generated: false, content, ...extra }).select("id").single(); if (error) throw error; return data!.id;
  }
  async function group() {
    const { data } = await f.db.from("conversations").insert({ kind: "group", title: "Reported private group", created_by: f.luca.userId }).select("id").single(); const id = data!.id;
    await f.db.from("conversation_members").insert({ conversation_id: id, user_id: f.luca.userId, role: "owner" });
    const old = await message(id, "EARLIER_HISTORY_SECRET");
    await f.db.from("conversation_members").insert({ conversation_id: id, user_id: f.marco.userId });
    const shared = await message(id, "Selected shared evidence"); const hidden = await message(id, "PRIVATE_AGENT_SECRET", { visible_to: f.marco.userId });
    return { id, old, shared, hidden };
  }
  async function submit(target: string, evidence: string[] = [], who = "marco", kind = "group") {
    const result = await clients[who].rpc("submit_platform_report", { p_kind: kind, p_target: target, p_category: "abuse", p_reason: "PRIVATE_REPORT_REASON", p_evidence: evidence });
    const data = result.data as { id: string; case_id: string; duplicate: boolean } | null; if (data?.case_id) cases.add(data.case_id); return { ...result, data };
  }
  const caseRow = async (id: string) => (await f.db.from("platform_cases").select("*").eq("id", id).single()).data!;
  async function decide(id: string, action: string, response = "Reviewed against the platform rules.", note = "INTERNAL_REVIEWER_NOTE") {
    return clients.paul.rpc("review_platform_case", { p_case: id, p_revision: (await caseRow(id)).revision, p_action: action, p_response: response, p_note: note });
  }
  it("defaults to no staff privilege, denies self-promotion and keeps group admins away from whole-space reports", async () => {
    const g = await group(); const result = await submit(g.id, [g.shared]); expect(result.error).toBeNull(); const c = result.data!.case_id;
    expect((await clients.luca.rpc("is_platform_moderator")).data).toBe(false);
    expect((await clients.luca.from("platform_moderators").insert({ user_id: f.luca.userId })).error).toBeTruthy();
    expect((await clients.luca.from("platform_cases").select("id").eq("id", c)).data).toEqual([]);
    expect((await clients.luca.from("platform_reports").select("*").eq("case_id", c)).data).toEqual([]);
    expect((await clients.business.rpc("own_platform_reports", { p_report: result.data!.id })).data).toEqual([]);
    expect((await clients.luca.rpc("review_platform_case", { p_case: c, p_revision: 2, p_action: "dismiss", p_response: "Dismissed by group owner." })).error).toBeTruthy();
    expect((await clients.paul.from("messages").select("id").eq("conversation_id", g.id)).data).toEqual([]); // Role never grants blanket chat access.
    expect((await clients.paul.from("platform_reports").select("reason,evidence").eq("case_id", c)).data).toEqual([expect.objectContaining({ reason: "PRIVATE_REPORT_REASON", evidence: [expect.objectContaining({ content: "Selected shared evidence" })] })]);
    expect((await clients.luca.from("platform_notifications").select("id")).data).toEqual([]);
  });
  it("rejects private, cross-space and pre-join evidence; the read API returns only the caller's shared messages", async () => {
    const g = await group(); const other = await group();
    for (const id of [g.hidden, g.old, other.shared]) expect((await submit(g.id, [id])).error).toBeTruthy();
    expect((await submit(g.id, [g.shared], "business")).error).toBeTruthy();
    session.user = { id: f.marco.userId }; session.client = clients.marco;
    const response = await GET(new Request(`http://localhost:3000/api/reports/evidence?kind=group&target=${g.id}`)); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    const text = JSON.stringify(await response.json()); expect(text).toContain("Selected shared evidence"); expect(text).not.toContain("EARLIER_HISTORY_SECRET"); expect(text).not.toContain("PRIVATE_AGENT_SECRET");
    const noEvidence = await submit(g.id); expect(noEvidence.error).toBeNull(); expect((await f.db.from("platform_reports").select("evidence").eq("id", noEvidence.data!.id).single()).data!.evidence).toEqual([]);
    const anon = createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } }); expect((await anon.rpc("submit_platform_report", { p_kind: "group", p_target: g.id, p_category: "other", p_reason: "Anonymous", p_actor: f.marco.userId })).error).toBeTruthy();
    expect((await clients.luca.rpc("submit_platform_report", { p_kind: "group", p_target: g.id, p_category: "other", p_reason: "Spoof", p_actor: f.marco.userId })).error).toBeTruthy();
  });
  it("deduplicates concurrent submissions and groups independent reporters into one case", async () => {
    const g = await group(); const [a, b] = await Promise.all([submit(g.id), submit(g.id)]); expect(a.error).toBeNull(); expect(b.error).toBeNull(); expect(a.data!.id).toBe(b.data!.id);
    const owner = await submit(g.id, [], "luca"); expect(owner.error).toBeNull(); expect(owner.data!.case_id).toBe(a.data!.case_id);
    expect((await f.db.from("platform_reports").select("id").eq("case_id", a.data!.case_id)).data).toHaveLength(2);
    const own = await clients.marco.rpc("own_platform_reports"); const items = OwnReport.array().parse(own.data); expect(items.some((r) => r.id === a.data!.id)).toBe(true); expect(items.some((r) => r.id === owner.data!.id)).toBe(false);
  });
  it("records human decisions, protects internal notes and notifies reporters without identifying them to admins", async () => {
    const g = await group(); const result = await submit(g.id); const c = result.data!.case_id;
    const revision = (await caseRow(c)).revision;
    expect((await clients.paul.rpc("review_platform_case", { p_case: c, p_revision: null as unknown as number, p_action: "review" })).error).toBeTruthy();
    expect((await clients.paul.rpc("review_platform_case", { p_case: c, p_revision: revision, p_action: "warn", p_response: null as unknown as string })).error).toBeTruthy();
    expect((await caseRow(c)).revision).toBe(revision);
    expect((await decide(c, "review")).error).toBeNull(); expect((await caseRow(c)).status).toBe("in_review");
    const stale = (await caseRow(c)).revision - 1; expect((await clients.paul.rpc("review_platform_case", { p_case: c, p_revision: stale, p_action: "dismiss", p_response: "Old review." })).error).toBeTruthy();
    expect((await decide(c, "warn", "Please stop sharing abusive content.")).error).toBeNull(); expect((await caseRow(c)).outcome).toBe("warned");
    const own = JSON.stringify((await clients.marco.rpc("own_platform_reports", { p_report: result.data!.id })).data); expect(own).toContain("Please stop sharing abusive content."); expect(own).not.toContain("INTERNAL_REVIEWER_NOTE"); expect(own).not.toContain(f.paul.userId);
    expect((await clients.marco.from("platform_case_events").select("*").eq("case_id", c)).data).toEqual([]);
    const adminNotice = (await clients.luca.from("platform_notifications").select("text").like("text", "%warning for%")).data!; expect(adminNotice).toHaveLength(1); expect(JSON.stringify(adminNotice)).not.toContain("PRIVATE_REPORT_REASON"); expect(JSON.stringify(adminNotice)).not.toContain(f.marco.agent.handle);
    const audit = await clients.paul.from("platform_case_events").select("actor_id,action,internal_note").eq("case_id", c); expect(audit.data).toHaveLength(2); expect(audit.data!.every((e) => e.actor_id === f.paul.userId && e.internal_note === "INTERNAL_REVIEWER_NOTE")).toBe(true);
  });
  it("suspends and restores posting, joining, reactions and poll responses without deleting history", async () => {
    const g = await group(); const c = (await submit(g.id)).data!.case_id;
    const { data: task } = await f.db.from("tasks").insert({ owner_id: f.luca.userId, initiator_agent: f.luca.agent.id, conversation_id: f.myAgent, group_conversation_id: g.id, status: "completed", goal: "An existing poll", parsed: {} }).select("id").single();
    const { data: step } = await f.db.from("plan_steps").insert({ task_id: task!.id, position: 0, type: "poll", status: "done", config: {} }).select("id").single();
    expect((await decide(c, "suspend", "Suspended for repeated harassment.")).error).toBeNull();
    expect((await clients.business.rpc("space_is_suspended", { p_conversation: g.id })).data).toBe(false); // Private-space metadata stays private.
    expect((await clients.paul.rpc("platform_case_suspended", { p_case: c })).data).toBe(true);
    expect((await f.db.from("messages").insert({ conversation_id: g.id, sender_user_id: f.marco.userId, content: "Blocked write", is_ai_generated: false })).error).toBeTruthy();
    expect((await f.db.from("messages").insert({ conversation_id: g.id, sender_agent_id: f.business.agent.id, content: "Blocked agent", is_ai_generated: true })).error).toBeTruthy();
    expect((await f.db.from("conversation_members").insert({ conversation_id: g.id, user_id: f.paul.userId })).error).toBeTruthy();
    expect((await clients.marco.rpc("set_message_reaction", { p_message: g.shared, p_reaction: "heart" })).error).toBeTruthy();
    expect((await f.db.from("step_responses").insert({ step_id: step!.id, agent_id: f.marco.agent.id, value: { option: "Yes" } })).error).toBeTruthy();
    const conversation = (await f.db.from("conversations").select("*").eq("id", g.id).single()).data!; expect(await canPost(conversation, f.marco.userId)).toMatchObject({ ok: false });
    expect((await clients.marco.from("messages").select("id").eq("id", g.shared)).data).toHaveLength(1);
    expect((await decide(c, "restore", "Restrictions lifted after review.")).error).toBeNull(); expect((await clients.marco.rpc("set_message_reaction", { p_message: g.shared, p_reaction: "heart" })).error).toBeNull();
    expect((await f.db.from("messages").insert({ conversation_id: g.id, sender_user_id: f.marco.userId, content: "Allowed after restore", is_ai_generated: false })).error).toBeNull();
  });
  it("denies self-review after leaving and enforces role revocation immediately", async () => {
    const g = await group(); const c = (await submit(g.id)).data!.case_id;
    await f.db.from("platform_moderators").insert([{ user_id: f.luca.userId }, { user_id: f.marco.userId }]);
    await f.db.from("conversation_members").delete().eq("conversation_id", g.id).in("user_id", [f.luca.userId, f.marco.userId]);
    for (const who of ["luca", "marco"]) expect((await clients[who].rpc("review_platform_case", { p_case: c, p_revision: (await caseRow(c)).revision, p_action: "dismiss", p_response: "Self review denied." })).error).toBeTruthy();
    await f.db.from("platform_moderators").delete().in("user_id", [f.luca.userId, f.marco.userId]);
    await f.db.from("platform_moderators").update({ enabled: false }).eq("user_id", f.paul.userId); expect((await decide(c, "dismiss")).error).toBeTruthy(); expect((await clients.paul.from("platform_cases").select("id").eq("id", c)).data).toEqual([]);
    await f.db.from("platform_moderators").update({ enabled: true }).eq("user_id", f.paul.userId);
  });
  it("retains submitted evidence and reporter status after the group is deleted", async () => {
    const g = await group(); const report = (await submit(g.id, [g.shared])).data!;
    expect((await f.db.from("conversations").delete().eq("id", g.id)).error).toBeNull(); expect((await caseRow(report.case_id)).group_id).toBeNull();
    const own = OwnReport.array().parse((await clients.marco.rpc("own_platform_reports", { p_report: report.id })).data); expect(own[0].evidence[0].content).toBe("Selected shared evidence");
    expect((await decide(report.case_id, "suspend")).error).toBeTruthy(); expect((await decide(report.case_id, "dismiss", "The space was deleted; no further action.")).error).toBeNull();
  });
  it("supports community reports and leaves individual message reports in local moderation with My Agent review links", async () => {
    const made = await createCommunity({ userId: f.luca.userId, agent: f.luca.agent }, { name: `Platform ${crypto.randomUUID().slice(0, 8)}`, description: "A community for testing independent platform review", avatar: "💬", visibility: "public" }); if (!made.ok) throw new Error(made.error); communities.push(made.id);
    expect(await joinCommunity(made.id, { userId: f.marco.userId, agent: f.marco.agent }, { acceptRules: true })).toMatchObject({ ok: true });
    const channel = (await f.db.from("conversations").select("id").eq("community_id", made.id).eq("channel", "general").single()).data!.id;
    const text = await message(channel, "A local reported message"); expect(await reportMessage(text, f.marco.userId, "Local message concern")).toEqual({ ok: true });
    const attention = (await clients.luca.rpc("platform_attention")).data as { local: { id: string }[] }; expect(attention.local.some((r) => r.id === made.id)).toBe(true);
    const platform = await submit(made.id, [text], "marco", "community"); expect(platform.error).toBeNull(); expect((await decide(platform.data!.case_id, "suspend")).error).toBeNull();
    expect((await f.db.from("messages").insert({ conversation_id: channel, sender_user_id: f.marco.userId, content: "Blocked community post", is_ai_generated: false })).error).toBeTruthy();
    expect((await f.db.from("community_members").insert({ community_id: made.id, user_id: f.paul.userId })).error).toBeTruthy();
    expect((await clients.luca.from("platform_reports").select("id").eq("case_id", platform.data!.case_id)).data).toEqual([]);
  });
  it("serializes new reports against decisions and exposes private, acknowledgeable My Agent updates", async () => {
    const g = await group(); const original = (await submit(g.id)).data!; const revision = (await caseRow(original.case_id)).revision;
    const [report, review] = await Promise.all([
      submit(g.id, [], "luca"),
      clients.paul.rpc("review_platform_case", { p_case: original.case_id, p_revision: revision, p_action: "review" }),
    ]);
    expect(report.error).toBeNull();
    // Whichever transaction wins, the other must finish or request a fresh revision, never deadlock.
    if (review.error) { expect(review.error.message).toContain("This case changed"); expect((await decide(original.case_id, "review")).error).toBeNull(); }
    const { data: homes } = await f.db.from("conversations").select("id,conversation_members!inner(user_id)").eq("kind", "my_agent").eq("conversation_members.user_id", f.marco.userId); expect(homes!.length).toBeGreaterThan(0);
    const notices = (await clients.marco.from("platform_notifications").select("id,seen_at").is("seen_at", null)).data!; expect(notices.length).toBeGreaterThan(0);
    expect((await clients.business.rpc("ack_platform_notifications", { p_ids: [notices[0].id] })).error).toBeNull();
    expect((await clients.marco.from("platform_notifications").select("seen_at").eq("id", notices[0].id).single()).data!.seen_at).toBeNull();
    expect((await clients.marco.rpc("ack_platform_notifications", { p_ids: [notices[0].id] })).error).toBeNull();
    expect((await clients.marco.from("platform_notifications").select("seen_at").eq("id", notices[0].id).single()).data!.seen_at).not.toBeNull();
  });
  it("limits new reports to five per day while repeated pending submissions remain idempotent", async () => {
    let first: { target: string; id: string } | null = null;
    for (let i = 0; i < 5; i++) { const g = await group(); const result = await submit(g.id); expect(result.error).toBeNull(); first ??= { target: g.id, id: result.data!.id }; }
    expect((await submit(first!.target)).data!.id).toBe(first!.id);
    const sixth = await group(); expect((await submit(sixth.id)).error).toBeTruthy();
  });
});
