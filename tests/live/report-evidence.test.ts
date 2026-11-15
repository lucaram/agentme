import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, dbUp, SUPABASE_URL } from "./env";
import { planBusinessFixture } from "../fixtures/plan-business";
import { GET } from "@/app/api/reports/evidence/route";
import { OwnReport } from "@/lib/moderation/types";
import type { Database } from "@/lib/database.types";
import { createCommunity, joinCommunity } from "@/lib/social/communities";

const session = vi.hoisted(() => ({ user: null as { id: string } | null, client: null as unknown }));
vi.mock("@/lib/auth", () => ({ getUser: async () => session.user }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));

describe.skipIf(!dbUp)("private evidence-based reporting", () => {
  let f: Awaited<ReturnType<typeof planBusinessFixture>>; const cases = new Set<string>(); const communities: string[] = [];
  const clients: Record<string, ReturnType<typeof createClient<Database>>> = {};
  beforeAll(async () => {
    f = await planBusinessFixture();
    for (const [key, person] of Object.entries({ luca: f.luca, marco: f.marco, paul: f.paul, business: f.business })) {
      const client = createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
      const { error } = await client.auth.signInWithPassword({ email: person.email, password: f.password }); if (error) throw error; clients[key] = client;
    }
    await f.db.from("platform_moderators").insert({ user_id: f.paul.userId });
  });
  beforeEach(async () => { await f.db.from("rate_limits").delete().in("key", [`platformReports:${f.marco.userId}`, `localReports:${f.marco.userId}`]); });
  afterAll(async () => { if (f) { if (cases.size) await f.db.from("platform_cases").delete().in("id", [...cases]); if (communities.length) await f.db.from("communities").delete().in("id", communities); await f.cleanup(); } });
  async function space(kind: "dm" | "group" = "dm") {
    const { data, error } = await f.db.from("conversations").insert({ kind, title: "Evidence example", description: "Original description", created_by: f.luca.userId }).select("id").single(); if (error) throw error;
    const id = data!.id; await f.db.from("conversation_members").insert({ conversation_id: id, user_id: f.luca.userId, role: "owner" });
    const old = await message(id, "BEFORE_JOIN_SECRET");
    await f.db.from("conversation_members").insert({ conversation_id: id, user_id: f.marco.userId });
    const primary = await message(id, "Original discriminatory message"); const hidden = await message(id, "PRIVATE_AGENT_EXCHANGE", f.marco.userId);
    const context = await message(id, "Shared surrounding context"); return { id, old, primary, hidden, context };
  }
  async function message(conv: string, content: string, visible?: string) {
    const { data, error } = await f.db.from("messages").insert({ conversation_id: conv, sender_user_id: f.luca.userId, content, visible_to: visible, is_ai_generated: false }).select("id").single(); if (error) throw error; return data!.id;
  }
  async function versions(ids: string[]) { const { data } = await f.db.from("messages").select("id,content").in("id", ids); return Object.fromEntries(data!.map((m) => [m.id, createHash("sha256").update(m.content).digest("hex")])); }
  async function submit(target: string, ids: string[], kind = "message", who = "marco") {
    const result = await clients[who].rpc("submit_platform_report", { p_kind: kind, p_target: target, p_category: "hate", p_reason: "A concern with supporting evidence", p_evidence: ids, p_versions: await versions(ids) });
    const report = result.data as { id: string; case_id: string } | null; if (report) cases.add(report.case_id); return { ...result, report };
  }
  async function revision(id: string) { return (await f.db.from("platform_cases").select("revision").eq("id", id).single()).data!.revision; }
  it("previews a DM message with only visible optional context, and gives staff no access to the DM", async () => {
    const s = await space(); session.user = { id: f.marco.userId }; session.client = clients.marco;
    const response = await GET(new Request(`http://localhost/api/reports/evidence?kind=message&target=${s.primary}`)); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    const data = await response.json(); expect(data.messages.map((m: { id: string }) => m.id)).toEqual([s.old, s.primary, s.context]); expect(JSON.stringify(data)).not.toContain("PRIVATE_AGENT_EXCHANGE");
    const result = await submit(s.primary, [s.primary, s.context]); expect(result.error).toBeNull();
    expect((await clients.luca.from("platform_reports").select("id").eq("case_id", result.report!.case_id)).data).toEqual([]);
    expect((await clients.paul.from("messages").select("id").eq("conversation_id", s.id)).data).toEqual([]);
    expect((await clients.paul.from("platform_reports").select("evidence").eq("id", result.report!.id).single()).data!.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ id: s.primary, content: "Original discriminatory message", author: "Luca", at: expect.any(String) })]));
  });
  it("rejects private, pre-join, cross-chat, My Agent, missing-primary and spoofed evidence", async () => {
    const s = await space("group"); const other = await space("group");
    for (const ids of [[s.primary, s.hidden], [s.primary, s.old], [s.primary, other.context], [s.context]]) expect((await submit(s.primary, ids)).error).toBeTruthy();
    const personal = await message(f.myAgent, "PERSONAL_ASSISTANT_SECRET"); expect((await submit(personal, [personal], "message", "luca")).error).toBeTruthy();
    expect((await submit(s.primary, [s.primary], "message", "business")).error).toBeTruthy();
    expect((await clients.business.rpc("submit_platform_report", { p_kind: "message", p_target: s.primary, p_category: "hate", p_reason: "Spoofed", p_evidence: [s.primary], p_actor: f.marco.userId })).error).toBeTruthy();
    const dm = await space(); expect((await clients.marco.rpc("submit_local_message_report", { p_message: dm.primary, p_reason: "DMs have no local admins" })).error).toBeTruthy();
  });
  it("detects changed previews and preserves submitted evidence after deletion and platform removal", async () => {
    const s = await space(); const oldVersions = await versions([s.primary]); await f.db.from("messages").update({ content: "Edited content" }).eq("id", s.primary);
    expect((await clients.marco.rpc("submit_platform_report", { p_kind: "message", p_target: s.primary, p_category: "hate", p_reason: "Changed", p_evidence: [s.primary], p_versions: oldVersions })).error).toBeTruthy();
    const result = await submit(s.primary, [s.primary]); expect(result.error).toBeNull();
    expect((await clients.luca.rpc("delete_own_message", { p_message: s.primary })).error).toBeNull();
    const own = OwnReport.array().parse((await clients.marco.rpc("own_platform_reports", { p_report: result.report!.id })).data); expect(own[0].evidence[0].content).toBe("Edited content");
    expect((await clients.paul.rpc("review_platform_case", { p_case: result.report!.case_id, p_revision: await revision(result.report!.case_id), p_action: "suspend", p_response: "Must not suspend a whole DM." })).error).toBeTruthy();
    expect((await clients.paul.rpc("review_platform_case", { p_case: result.report!.case_id, p_revision: await revision(result.report!.case_id), p_action: "remove", p_response: "The reported content was removed." })).error).toBeNull();
    expect((await f.db.from("messages").select("content,deleted_at").eq("id", s.primary).single()).data).toMatchObject({ content: "Deleted message", deleted_at: expect.any(String) });
  });
  it("supports separate local and platform reporting, keeping the platform report private from group admins", async () => {
    const s = await space("group"); const args = { p_message: s.primary, p_reason: "Local concern", p_category: "hate", p_evidence: [s.primary, s.context], p_versions: await versions([s.primary, s.context]) };
    const [a, b] = await Promise.all([clients.marco.rpc("submit_local_message_report", args), clients.marco.rpc("submit_local_message_report", args)]); expect(a.error).toBeNull(); expect(b.data).toBe(a.data);
    expect((await clients.luca.from("reports").select("evidence").eq("id", a.data!).single()).data!.evidence).toHaveLength(2);
    const platform = await submit(s.primary, [s.primary]); expect(platform.error).toBeNull();
    expect((await clients.luca.from("platform_reports").select("id").eq("case_id", platform.report!.case_id)).data).toEqual([]);
    expect((await clients.paul.rpc("review_platform_case", { p_case: platform.report!.case_id, p_revision: await revision(platform.report!.case_id), p_action: "remove", p_response: "Removed after evidence review." })).error).toBeNull();
    expect((await f.db.from("messages").select("removed_at").eq("id", s.primary).single()).data!.removed_at).toBeTruthy();
    expect((await clients.luca.from("reports").select("evidence").eq("id", a.data!).single()).data!.evidence).toHaveLength(2);
  });
  it("requests evidence privately, keeps a persistent My Agent action and accepts an explanation after leaving", async () => {
    const s = await space("group"); const result = (await submit(s.id, [], "group")).report!; const originalRevision = await revision(result.case_id);
    expect((await clients.luca.rpc("request_report_evidence", { p_report: result.id, p_revision: originalRevision, p_question: "Please provide examples." })).error).toBeTruthy();
    const request = await clients.paul.rpc("request_report_evidence", { p_report: result.id, p_revision: originalRevision, p_question: "Please share specific messages and their context." }); expect(request.error).toBeNull();
    expect((await clients.luca.from("platform_evidence_requests").select("id").eq("id", request.data!)).data).toEqual([]);
    expect((await clients.business.rpc("answer_report_evidence", { p_request: request.data!, p_reply: "Not the reporter" })).error).toBeTruthy();
    expect((await clients.marco.rpc("own_evidence_requests")).data).toEqual(expect.arrayContaining([expect.objectContaining({ report_id: result.id })]));
    expect((await clients.paul.rpc("platform_case_queue", { p_state: "waiting" })).data).toEqual(expect.arrayContaining([expect.objectContaining({ id: result.case_id })]));
    const additional = await submit(s.id, [s.context], "group", "luca"); expect(additional.error).toBeNull(); expect(additional.report!.case_id).toBe(result.case_id);
    expect((await clients.paul.rpc("platform_case_queue")).data).toEqual(expect.arrayContaining([expect.objectContaining({ id: result.case_id, status: "in_review" })]));
    await f.db.from("conversation_members").delete().eq("conversation_id", s.id).eq("user_id", f.marco.userId);
    expect((await clients.marco.rpc("answer_report_evidence", { p_request: request.data!, p_reply: "I left and cannot provide further messages.", p_evidence: [] })).error).toBeNull();
    expect((await clients.marco.rpc("own_evidence_requests")).data).toEqual([]);
    expect((await clients.marco.rpc("answer_report_evidence", { p_request: request.data!, p_reply: "Duplicate answer" })).error).toBeTruthy();
    expect((await clients.paul.rpc("platform_case_queue")).data).toEqual(expect.arrayContaining([expect.objectContaining({ id: result.case_id, status: "in_review" })]));
    const own = OwnReport.array().parse((await clients.marco.rpc("own_platform_reports", { p_report: result.id })).data); expect(own[0].requests[0].reply).toContain("I left");
  });
  it("keeps group snapshots and additional submitted evidence immutable and closes unanswered evidence requests on a decision", async () => {
    const s = await space("group"); const result = (await submit(s.id, [], "group")).report!;
    await f.db.from("conversations").update({ title: "Changed name", description: "Changed description" }).eq("id", s.id);
    const own = OwnReport.array().parse((await clients.marco.rpc("own_platform_reports", { p_report: result.id })).data); expect(own[0]).toMatchObject({ title: "Evidence example", description: "Original description" });
    const q = await clients.paul.rpc("request_report_evidence", { p_report: result.id, p_revision: await revision(result.case_id), p_question: "Please share the exact message." }); expect(q.error).toBeNull();
    expect((await clients.marco.rpc("answer_report_evidence", { p_request: q.data!, p_reply: "Here is the message", p_evidence: [s.primary], p_versions: await versions([s.primary]) })).error).toBeNull();
    await f.db.from("messages").update({ content: "Changed after submission" }).eq("id", s.primary);
    const records = (await clients.paul.from("platform_evidence_requests").select("evidence").eq("id", q.data!).single()).data!; expect(records.evidence).toEqual([expect.objectContaining({ content: "Original discriminatory message" })]);
    expect((await clients.marco.from("platform_evidence_requests").update({ reply: "Tampered" }).eq("id", q.data!)).error).toBeTruthy();
    const next = await clients.paul.rpc("request_report_evidence", { p_report: result.id, p_revision: await revision(result.case_id), p_question: "Any further relevant details?" });
    expect((await clients.paul.rpc("review_platform_case", { p_case: result.case_id, p_revision: await revision(result.case_id), p_action: "dismiss", p_response: "Insufficient evidence for further action." })).error).toBeNull();
    expect((await clients.marco.rpc("answer_report_evidence", { p_request: next.data!, p_reply: "Too late" })).error).toBeTruthy();
    expect((await clients.marco.rpc("own_evidence_requests")).data).toEqual([]);
  });
  it("routes community messages separately to local moderators or platform staff and snapshots the community rules", async () => {
    const made = await createCommunity({ userId: f.luca.userId, agent: f.luca.agent }, { name: `Evidence ${crypto.randomUUID().slice(0, 8)}`, description: "Community evidence and privacy testing", visibility: "public", avatar: "💬" }); if (!made.ok) throw new Error(made.error); communities.push(made.id);
    expect(await joinCommunity(made.id, { userId: f.marco.userId, agent: f.marco.agent }, { acceptRules: true })).toMatchObject({ ok: true });
    const channel = (await f.db.from("conversations").select("id").eq("community_id", made.id).eq("channel", "general").single()).data!.id;
    const primary = await message(channel, "A community message under review"); await message(channel, "PRIVATE_COMMUNITY_AGENT", f.marco.userId);
    const local = await clients.marco.rpc("submit_local_message_report", { p_message: primary, p_reason: "For local moderators", p_category: "hate", p_evidence: [primary], p_versions: await versions([primary]) }); expect(local.error).toBeNull();
    expect((await clients.luca.from("reports").select("evidence").eq("id", local.data!).single()).data!.evidence).toHaveLength(1);
    const platform = await submit(primary, [primary]); expect(platform.error).toBeNull();
    expect((await clients.luca.from("platform_reports").select("id").eq("case_id", platform.report!.case_id)).data).toEqual([]);
    const whole = await submit(made.id, [], "community"); expect(whole.error).toBeNull();
    const original = (await f.db.from("communities").select("rules").eq("id", made.id).single()).data!.rules;
    const own = OwnReport.array().parse((await clients.marco.rpc("own_platform_reports", { p_report: whole.report!.id })).data); expect(own[0].rules).toBe(original);
    session.user = { id: f.marco.userId }; session.client = clients.marco;
    const preview = await GET(new Request(`http://localhost/api/reports/evidence?kind=community&target=${made.id}`)); expect(preview.status).toBe(200); const body = await preview.json(); expect(body.space.rules).toBe(original); expect(JSON.stringify(body)).not.toContain("PRIVATE_COMMUNITY_AGENT");
  });
  it("paginates older supporting messages without duplicates or foreign cursors and refuses outsider previews", async () => {
    const s = await space("group"); const other = await space("group");
    const { error } = await f.db.from("messages").insert(Array.from({ length: 24 }, (_, i) => ({ conversation_id: s.id, sender_user_id: f.luca.userId, content: `Supporting message ${i}`, is_ai_generated: false }))); expect(error).toBeNull();
    session.user = { id: f.marco.userId }; session.client = clients.marco;
    const first = await GET(new Request(`http://localhost/api/reports/evidence?kind=group&target=${s.id}`)); const a = await first.json(); expect(a.messages).toHaveLength(20); expect(a.next).toBeTruthy();
    const second = await GET(new Request(`http://localhost/api/reports/evidence?kind=group&target=${s.id}&before=${a.next}`)); const b = await second.json(); expect(b.messages).toHaveLength(6); expect(b.next).toBeNull();
    const ids = [...a.messages, ...b.messages].map((m: { id: string }) => m.id); expect(new Set(ids).size).toBe(26); expect(ids).not.toContain(s.old); expect(ids).not.toContain(s.hidden);
    expect((await GET(new Request(`http://localhost/api/reports/evidence?kind=group&target=${s.id}&before=${other.primary}`))).status).toBe(400);
    session.user = { id: f.business.userId }; session.client = clients.business; expect((await GET(new Request(`http://localhost/api/reports/evidence?kind=group&target=${s.id}`))).status).toBe(404);
    session.user = null; expect((await GET(new Request(`http://localhost/api/reports/evidence?kind=group&target=${s.id}`))).status).toBe(401);
  });
});
