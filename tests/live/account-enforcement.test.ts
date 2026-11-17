import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { decodeJwt } from "jose";
import { ANON_KEY, dbUp, SUPABASE_URL } from "./env";
import { planBusinessFixture } from "../fixtures/plan-business";
import { OwnSanction, ReportingHistoryEntry } from "@/lib/moderation/types";
import { handleA2ARequest } from "@/lib/a2a/server";
import { accountRestricted } from "@/lib/moderation/accounts";
import type { Database } from "@/lib/database.types";

describe.skipIf(!dbUp)("account enforcement and private appeals", () => {
  let f: Awaited<ReturnType<typeof planBusinessFixture>>;
  const clients: Record<string, ReturnType<typeof createClient<Database>>> = {};
  const cases = new Set<string>(); const extraUsers: string[] = []; let otherReviewer = "";
  const signIn = async (email: string) => {
    const client = createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const result = await client.auth.signInWithPassword({ email, password: f.password }); if (result.error) throw result.error;
    return client;
  };
  beforeAll(async () => {
    f = await planBusinessFixture();
    for (const [key, person] of Object.entries({ luca: f.luca, marco: f.marco, paul: f.paul, business: f.business })) clients[key] = await signIn(person.email);
    const email = `appeal-${crypto.randomUUID()}@agentme.test`;
    const { data, error } = await f.db.auth.admin.createUser({ email, password: f.password, email_confirm: true }); if (error) throw error;
    otherReviewer = data.user.id; extraUsers.push(otherReviewer);
    expect((await f.db.from("agents").insert({ owner_id: otherReviewer, handle: `appeal_${crypto.randomUUID().slice(0, 8)}`, display_name: "Independent reviewer", type: "personal" })).error).toBeNull();
    clients.eve = await signIn(email);
    expect((await f.db.from("platform_moderators").insert([{ user_id: f.paul.userId }, { user_id: otherReviewer }])).error).toBeNull();
  });
  const clearDecisions = async () => {
    if (!f) return;
    await f.db.from("platform_account_sanctions").delete().in("user_key", [f.luca.userId, f.marco.userId, f.paul.userId, f.business.userId, ...extraUsers]);
    if (cases.size) { await f.db.from("platform_cases").delete().in("id", [...cases]); cases.clear(); }
    await f.db.from("rate_limits").delete().like("key", `%${f.luca.userId}%`);
  };
  beforeEach(clearDecisions);
  afterAll(async () => { if (!f) return; await clearDecisions(); await f.db.from("platform_operators").delete().eq("user_id", f.marco.userId); await f.cleanup(); for (const id of extraUsers) await f.db.auth.admin.deleteUser(id); });
  async function report(kind = "message", author = f.marco.userId, evidence = true) {
    const { data: conversation, error } = await f.db.from("conversations").insert({ kind: kind === "message" ? "dm" : "group", created_by: f.luca.userId, title: "Isolated enforcement case" }).select("id").single(); if (error) throw error;
    expect((await f.db.from("conversation_members").insert([f.luca.userId, f.marco.userId, ...(author === f.paul.userId ? [author] : [])].map((user_id) => ({ conversation_id: conversation!.id, user_id, role: user_id === f.luca.userId ? "owner" : "member" })))).error).toBeNull();
    const { data: msg, error: msgError } = await f.db.from("messages").insert({ conversation_id: conversation!.id, sender_user_id: author, content: "Submitted evidence for account review", is_ai_generated: false }).select("id").single(); if (msgError) throw msgError;
    const result = await clients.luca.rpc("submit_platform_report", { p_kind: kind, p_target: kind === "message" ? msg!.id : conversation!.id, p_category: "abuse", p_reason: "Reporter explanation stays private", p_evidence: evidence ? [msg!.id] : [] });
    if (result.error) throw result.error; const saved = result.data as { case_id: string }; cases.add(saved.case_id);
    return { id: saved.case_id, message: msg!.id, conversation: conversation!.id };
  }
  const revision = async (id: string) => (await f.db.from("platform_cases").select("revision").eq("id", id).single()).data!.revision;
  const sanction = async (id: string) => (await f.db.from("platform_account_sanctions").select("*").eq("case_id", id).single()).data!;
  async function decide(c: Awaited<ReturnType<typeof report>>, action = "suspend_1m", extra = {}) {
    return clients.paul.rpc("review_platform_case", { p_case: c.id, p_revision: await revision(c.id), p_action: action, p_response: "Repeated abusive messages after review.", p_note: "PRIVATE_INTERNAL_NOTES", p_subject: f.marco.userId, p_evidence: c.message, ...extra });
  }
  it.each(["suspend_1m", "suspend_3m", "ban"])("records %s with calendar expiry and a private, appealable notice", async (action) => {
    const c = await report(); expect((await decide(c, action)).error).toBeNull(); const s = await sanction(c.id);
    expect(s.action).toBe(action); expect(s.user_key).toBe(f.marco.userId); expect(s.actor_id).toBe(f.paul.userId);
    if (action === "ban") expect(s.expires_at).toBeNull(); else { const until = new Date(s.created_at); until.setUTCMonth(until.getUTCMonth() + (action === "suspend_1m" ? 1 : 3)); expect(new Date(s.expires_at!).getTime()).toBe(until.getTime()); }
    expect(await accountRestricted(f.marco.userId)).toBe(true);
    const own = OwnSanction.array().parse((await clients.marco.rpc("own_account_sanctions")).data); expect(own[0]).toMatchObject({ justification: s.justification, restriction_status: "active" });
    const notices = (await clients.marco.from("platform_notifications").select("text,link")).data!; expect(notices.some((n) => n.text.includes(s.justification) && n.link === "/account-status")).toBe(true);
    expect(JSON.stringify(notices)).not.toContain("Reporter explanation"); expect(JSON.stringify(notices)).not.toContain("PRIVATE_INTERNAL_NOTES");
    expect((await clients.luca.from("platform_account_sanctions").select("id")).data).toEqual([]);
    expect((await clients.marco.from("platform_account_sanctions").update({ revoked_at: new Date().toISOString() }).eq("id", s.id)).error).toBeTruthy();
    expect((await decide(c, action)).error).toBeTruthy();
  });
  it("requires valid human review, justification and the reported subject, protecting operators and other reviewers", async () => {
    const c = await report();
    for (const extra of [{ p_response: "" }, { p_revision: -1 }, { p_subject: f.business.userId }]) expect((await decide(c, "ban", extra)).error).toBeTruthy();
    expect((await clients.luca.rpc("review_platform_case", { p_case: c.id, p_revision: await revision(c.id), p_action: "ban", p_response: "Untrusted actor." })).error).toBeTruthy();
    await f.db.from("platform_operators").insert({ user_id: f.marco.userId });
    expect((await decide(c, "ban")).error).toBeTruthy(); await f.db.from("platform_operators").delete().eq("user_id", f.marco.userId);
    await f.db.from("platform_moderators").insert({ user_id: f.marco.userId }); expect((await decide(c, "ban")).error).toBeTruthy(); await f.db.from("platform_moderators").delete().eq("user_id", f.marco.userId);
    expect((await f.db.from("platform_account_sanctions").select("id").eq("case_id", c.id)).data).toEqual([]);
  });
  it("stops old sessions, direct writes, autonomous messages and unfinished tasks while leaving other users operational", async () => {
    const c = await report("group");
    const task = await f.db.from("tasks").insert({ owner_id: f.marco.userId, initiator_agent: f.marco.agent.id, conversation_id: c.conversation, status: "awaiting_approval", goal: "Unfinished work" }).select("id").single(); expect(task.error).toBeNull();
    expect((await decide(c)).error).toBeNull();
    expect((await f.db.from("tasks").select("status").eq("id", task.data!.id).single()).data!.status).toBe("cancelled");
    expect((await clients.marco.from("messages").insert({ conversation_id: c.conversation, sender_user_id: f.marco.userId, content: "Old session bypass", is_ai_generated: false })).error?.message).toContain("restricted");
    expect((await f.db.from("messages").insert({ conversation_id: c.conversation, sender_agent_id: f.marco.agent.id, content: "Agent bypass", is_ai_generated: true })).error?.message).toContain("restricted");
    expect((await f.db.from("tasks").update({ status: "running" }).eq("id", task.data!.id)).error?.message).toContain("restricted");
    await clients.marco.from("agents").update({ display_name: "Bypass" }).eq("id", f.marco.agent.id);
    expect((await f.db.from("agents").select("display_name").eq("id", f.marco.agent.id).single()).data!.display_name).toBe("Marco");
    expect((await clients.marco.rpc("set_message_reaction", { p_message: c.message, p_reaction: "heart" })).error?.message).toContain("restricted");
    expect((await f.db.from("messages").insert({ conversation_id: c.conversation, sender_user_id: f.luca.userId, content: "Unaffected participant", is_ai_generated: false })).error).toBeNull();
    expect((await handleA2ARequest(new Request("http://localhost/a2a", { method: "POST", body: JSON.stringify({ id: "restricted", method: "SendMessage" }) }), f.marco.agent.handle)).status).toBe(403);
    expect((await clients.luca.from("messages").select("id").eq("id", c.message)).data).toHaveLength(1);
  });
  it("expires without a scheduled job, and lifting one decision never removes another active restriction", async () => {
    const a = await report(); const b = await report(); expect((await decide(a, "ban")).error).toBeNull(); expect((await decide(b, "suspend_3m")).error).toBeNull();
    expect((await clients.paul.rpc("lift_account_restriction", { p_sanction: (await sanction(a.id)).id, p_reason: "Corrected after further evidence." })).error).toBeNull();
    expect(await accountRestricted(f.marco.userId)).toBe(true);
    await f.db.from("platform_account_sanctions").update({ expires_at: "2020-01-01T00:00:00Z" }).eq("case_id", b.id);
    expect(await accountRestricted(f.marco.userId)).toBe(false);
    expect(OwnSanction.array().parse((await clients.marco.rpc("own_account_sanctions")).data).map((s) => s.restriction_status).sort()).toEqual(["expired", "lifted"]);
  });
  it("allows an appeal during a ban, requires an independent reviewer, and restores access on acceptance", async () => {
    const c = await report(); expect((await decide(c, "ban")).error).toBeNull(); const s = await sanction(c.id);
    expect((await clients.luca.rpc("submit_account_appeal", { p_sanction: s.id, p_reason: "Not my decision." })).error).toBeTruthy();
    const appeal = await clients.marco.rpc("submit_account_appeal", { p_sanction: s.id, p_reason: "Please consider the surrounding context." }); expect(appeal.error).toBeNull();
    expect((await clients.marco.rpc("submit_account_appeal", { p_sanction: s.id, p_reason: "Duplicate submission" })).data).toBe(appeal.data);
    expect((await clients.paul.rpc("account_appeal_queue")).data).toEqual([]);
    expect((await clients.paul.rpc("review_account_appeal", { p_appeal: appeal.data!, p_accept: true, p_response: "My original decision." })).error).toBeTruthy();
    expect((await clients.eve.rpc("open_account_appeal_count")).data).toBe(1);
    expect((await clients.eve.rpc("review_account_appeal", { p_appeal: appeal.data!, p_accept: true, p_response: "Context establishes that this restriction was mistaken." })).error).toBeNull();
    expect(await accountRestricted(f.marco.userId)).toBe(false);
    expect(OwnSanction.array().parse((await clients.marco.rpc("own_account_sanctions")).data)[0].appeal?.status).toBe("accepted");
    expect((await clients.eve.rpc("review_account_appeal", { p_appeal: appeal.data!, p_accept: false, p_response: "Cannot overwrite the independent decision." })).error).toBeTruthy();
  });
  it("keeps a rejected appeal in the audit and leaves the restriction active", async () => {
    const c = await report(); await decide(c); const s = await sanction(c.id); const before = await revision(c.id);
    const a = await clients.marco.rpc("submit_account_appeal", { p_sanction: s.id, p_reason: "Please review again." });
    expect((await clients.eve.rpc("review_account_appeal", { p_appeal: a.data!, p_accept: false, p_response: "The submitted evidence supports the restriction." })).error).toBeNull();
    expect(await revision(c.id)).toBeGreaterThan(before); expect(await accountRestricted(f.marco.userId)).toBe(true);
    expect((await clients.marco.rpc("own_account_sanctions")).data).toEqual([expect.objectContaining({ appeal: expect.objectContaining({ status: "rejected" }) })]);
  });
  it("shows prior reported and decision dates without treating pending or dismissed reports as findings", async () => {
    const a = await report(); const b = await report(); const c = await report();
    expect((await decide(a, "dismiss")).error).toBeNull(); expect((await decide(b, "suspend_1m")).error).toBeNull();
    const result = await clients.paul.rpc("platform_reporting_history", { p_case: c.id, p_subject: f.marco.userId }); expect(result.error).toBeNull();
    const rows = ReportingHistoryEntry.array().parse(result.data); expect(rows).toHaveLength(2); expect(rows.some((r) => r.id === c.id)).toBe(false);
    expect(rows.find((r) => r.id === a.id)).toMatchObject({ action: "dismissed", restriction_status: null }); expect(rows.find((r) => r.id === b.id)).toMatchObject({ action: "suspend_1m", restriction_status: "active" });
    expect(rows.every((r) => r.reported_at && r.decided_at)).toBe(true); expect(JSON.stringify(rows)).not.toContain("PRIVATE_INTERNAL_NOTES");
    expect((await clients.luca.rpc("platform_reporting_history", { p_case: c.id, p_subject: f.marco.userId })).error).toBeTruthy();
    expect((await clients.paul.rpc("platform_reporting_history", { p_case: c.id, p_subject: f.business.userId })).error).toBeTruthy();
  });
  it("requires an explicitly selected author and that author's evidence for whole-space account sanctions", async () => {
    const none = await report("group", f.marco.userId, false); expect((await clients.paul.rpc("account_case_people", { p_case: none.id })).data).toEqual([]); expect((await decide(none, "ban")).error).toBeTruthy();
    const c = await report("group"); expect((await decide(c, "ban", { p_subject: f.luca.userId })).error).toBeTruthy(); expect((await decide(c, "ban", { p_evidence: none.message })).error).toBeTruthy();
    expect((await decide(c, "ban")).error).toBeNull(); expect((await sanction(c.id)).user_key).toBe(f.marco.userId);
    expect((await f.db.from("conversations").select("platform_suspended").eq("id", c.conversation).single()).data!.platform_suspended).toBe(false);
  });
  it("binds switched business sessions to their manager without disabling a healthy co-owner", async () => {
    const email = `business+${crypto.randomUUID()}@business.agentme.app`; const made = await f.db.auth.admin.createUser({ email, password: f.password, email_confirm: true }); if (made.error) throw made.error;
    const user = made.data.user.id; extraUsers.push(user);
    const agent = await f.db.from("agents").insert({ owner_id: user, handle: `managed_${crypto.randomUUID().slice(0, 8)}`, display_name: "Co-owned business", type: "business" }).select("id").single(); expect(agent.error).toBeNull();
    await f.db.from("business_managers").insert([{ business_agent_id: agent.data!.id, user_id: f.marco.userId, role: "owner" }, { business_agent_id: agent.data!.id, user_id: f.luca.userId, role: "owner" }]);
    const bad = await signIn(f.marco.email); const good = await signIn(f.luca.email); const unbound = await signIn(email);
    for (const [client, person] of [[bad, f.marco.userId], [good, f.luca.userId]] as const) {
      const token = (await client.auth.getSession()).data.session!.access_token; const sessionId = decodeJwt(token).session_id as string;
      expect((await f.db.from("business_work_sessions").insert({ session_id: sessionId, business_agent_id: agent.data!.id, person_user: person })).error).toBeNull();
    }
    const c = await report("group"); expect((await decide(c)).error).toBeNull(); expect(await accountRestricted(user)).toBe(false);
    const own = await f.db.from("conversations").insert({ kind: "my_agent", created_by: user }).select("id").single(); expect(own.error).toBeNull();
    expect((await f.db.from("conversation_members").insert({ conversation_id: own.data!.id, user_id: user })).error).toBeNull();
    const shared = await f.db.from("messages").insert({ conversation_id: own.data!.id, sender_user_id: user, content: "Visible to business", is_ai_generated: false }).select("id").single(); expect(shared.error).toBeNull();
    for (const client of [bad, unbound]) expect((await client.from("messages").insert({ conversation_id: own.data!.id, sender_user_id: user, content: "Manager bypass", is_ai_generated: false })).error).toBeTruthy();
    expect((await good.rpc("set_message_reaction", { p_message: shared.data!.id, p_reaction: "heart" })).error).toBeNull();
    expect((await bad.from("managed_identity_sessions").insert({ session_id: crypto.randomUUID(), business_user: user, person_user: f.luca.userId })).error).toBeTruthy();
    await f.db.from("business_managers").delete().eq("business_agent_id", agent.data!.id).eq("user_id", f.luca.userId);
    expect(await accountRestricted(user)).toBe(true);
  });
});
