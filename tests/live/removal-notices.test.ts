import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dbUp } from "./env";
import { businessTeamsFixture } from "../fixtures/business-teams";

// Team: the business's own login is an Owner; Marco and Paul are Managers; Luca reports to Marco, Eve to Paul.
describe.skipIf(!dbUp)("removed from a business: who is told, and coming back later", () => {
  let f: Awaited<ReturnType<typeof businessTeamsFixture>>;
  beforeEach(async () => { f = await businessTeamsFixture(); });
  afterEach(async () => { await f?.cleanup(); });
  const ok = <T,>(result: { data: T; error: unknown }) => { expect(result.error).toBeNull(); return result.data!; };
  const notices = async (person: string) =>
    ok(await f.db.from("business_work_notices").select("text").eq("business_agent_id", f.business.agent.id).eq("recipient_id", person)).map((n) => n.text);

  it("a Manager removed by an Owner: their Staff are told in their work updates that the Manager was removed, when, and who they report to now", async () => {
    ok(await f.owner.rpc("change_business_member", { p_user: f.marco.userId, p_role: "remove" }));
    const [text] = await notices(f.luca.userId);
    expect(text).toMatch(/^Marco, who you reported to, was removed from the business on \d{1,2} [A-Z][a-z]{2} \d{4} at \d{2}:\d{2} UTC\. You now report to .+\.$/);
    // Luca sees it as a work update in My Agent while working in the business.
    const inbox = ok(await f.worker.rpc("business_work_inbox")) as { text: string }[];
    expect(inbox.map((n) => n.text)).toContain(text);
    expect(await notices(f.eve.userId)).toEqual([]); // another team isn't told
  });

  it("a Manager who leaves: their Staff are told they left (not that they were removed)", async () => {
    ok(await f.db.rpc("leave_business", { p_business: f.business.agent.id, p_person: f.paul.userId }));
    expect(await notices(f.eve.userId)).toEqual([expect.stringMatching(/^Paul, who you reported to, left the business\. You now report to .+\.$/)]);
  });

  it("a demotion keeps the old wording", async () => {
    ok(await f.owner.rpc("change_business_member", { p_user: f.marco.userId, p_role: "staff" }));
    expect((await notices(f.luca.userId))[0]).toMatch(/^Your supervisor has left that role\./);
  });

  it("access ends and the audit stays; invited again later, the same person rejoins and the earlier history is still there", async () => {
    ok(await f.owner.rpc("change_business_member", { p_user: f.luca.userId, p_role: "remove" }));
    expect(ok(await f.db.from("business_managers").select("user_id").eq("business_agent_id", f.business.agent.id).eq("user_id", f.luca.userId))).toEqual([]);
    const auditBefore = ok(await f.db.from("business_staff_audit").select("id, action").eq("business_agent_id", f.business.agent.id));
    expect(auditBefore.some((a) => a.action === "Access removed")).toBe(true);

    const invite = ok(await f.owner.rpc("issue_business_invite", { p_target: `@${f.luca.agent.handle}`, p_role: "staff", p_digest: createHash("sha256").update(crypto.randomUUID()).digest("hex") }));
    const personal = await f.signed(f.luca);
    ok(await personal.rpc("respond_business_invite", { p_invite: invite as string, p_accept: true }));
    expect(ok(await f.db.from("business_managers").select("role").eq("business_agent_id", f.business.agent.id).eq("user_id", f.luca.userId).single())).toEqual({ role: "staff" });
    // Nothing from before was lost: every earlier audit line is still there, and the reporting history has both stints.
    const auditAfter = ok(await f.db.from("business_staff_audit").select("id").eq("business_agent_id", f.business.agent.id)).map((a) => a.id);
    for (const a of auditBefore) expect(auditAfter).toContain(a.id);
    const stints = ok(await f.db.from("business_team_history").select("ended_at").eq("business_agent_id", f.business.agent.id).eq("staff_id", f.luca.userId));
    expect(stints.filter((s) => s.ended_at === null)).toHaveLength(1);
    expect(stints.filter((s) => s.ended_at !== null).length).toBeGreaterThanOrEqual(1);
  });
});
