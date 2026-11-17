import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dbUp } from "./env";
import { businessTeamsFixture } from "../fixtures/business-teams";
import { Departure } from "@/lib/business/departure";

// Team: the business's own login is an Owner; Marco and Paul are Managers; Luca reports to Marco, Eve to Paul.
describe.skipIf(!dbUp)("leaving a business voluntarily", () => {
  let f: Awaited<ReturnType<typeof businessTeamsFixture>>;
  beforeEach(async () => { f = await businessTeamsFixture(); });
  afterEach(async () => { await f?.cleanup(); });
  const ok = <T,>(result: { data: T; error: unknown }) => { expect(result.error).toBeNull(); return result.data!; };
  const leave = (person: string, dry = false) => f.db.rpc("leave_business", { p_business: f.business.agent.id, p_person: person, p_dry_run: dry });
  const member = async (person: string) => ok(await f.db.from("business_managers").select("role, supervisor_id").eq("business_agent_id", f.business.agent.id).eq("user_id", person).maybeSingle());
  async function assignedQuestion(to: string) {
    const id = ok(await f.db.from("inbox_items").insert({ owner_id: f.business.userId, agent_id: f.business.agent.id, kind: "question", payload: { kind: "question", business: true, question: "Do you deliver?" } }).select("id").single())!.id;
    ok(await f.manager1.rpc("claim_business_question", { p_item: id, p_assignee: to })); // Marco assigns it
    return id;
  }

  it("Staff leave: access ends, their assigned request goes back to the team, the audit stays, and their Manager is named", async () => {
    const request = await assignedQuestion(f.luca.userId);
    // Only the database's service role can call it: not the person's own session.
    expect((await f.worker.rpc("leave_business", { p_business: f.business.agent.id, p_person: f.luca.userId })).error).toBeTruthy();
    expect(ok(await leave(f.luca.userId, true))).toEqual({ role: "staff" });
    expect(await member(f.luca.userId)).toEqual({ role: "staff", supervisor_id: f.marco.userId }); // a dry run changes nothing

    const departure = Departure.parse(ok(await leave(f.luca.userId)));
    expect(departure).toMatchObject({ role: "staff", supervisor: f.marco.userId, supervisorRole: "manager", reports: [], owners: [{ id: f.business.userId, notify: true }] });
    expect(await member(f.luca.userId)).toBeNull();
    expect(ok(await f.db.from("business_question_claims").select("assigned_to").eq("inbox_id", request).single())!.assigned_to).toBeNull();
    const audit = ok(await f.db.from("business_staff_audit").select("actor_id, action").eq("business_agent_id", f.business.agent.id).like("action", "Left the business%"));
    expect(audit).toEqual([{ actor_id: f.luca.userId, action: "Left the business (Staff)" }]);
    // Their personal account is untouched.
    expect(ok(await f.db.from("agents").select("id").eq("owner_id", f.luca.userId).eq("type", "personal"))).toHaveLength(1);
    expect((await leave(f.luca.userId)).error?.message).toContain("not part of this business");
  });

  it("a Manager leaves: the Staff who reported to them move to the receiving Owner", async () => {
    const departure = Departure.parse(ok(await leave(f.marco.userId)));
    expect(departure.role).toBe("manager");
    expect(departure.reports).toEqual([{ id: f.luca.userId, supervisor: f.business.userId, supervisorName: expect.any(String) }]);
    expect(await member(f.luca.userId)).toEqual({ role: "staff", supervisor_id: f.business.userId });
    expect(await member(f.eve.userId)).toEqual({ role: "staff", supervisor_id: f.paul.userId }); // other teams unchanged
  });

  it("Owners can leave only while another Owner remains; the business's own login never leaves", async () => {
    expect((await leave(f.business.userId)).error?.message).toContain("business's own login");
    ok(await f.db.from("business_managers").update({ role: "owner" }).eq("business_agent_id", f.business.agent.id).eq("user_id", f.paul.userId));
    // With the login's own Owner row gone, Paul is the only Owner and can't leave.
    ok(await f.db.from("business_managers").update({ role: "manager" }).eq("business_agent_id", f.business.agent.id).eq("user_id", f.business.userId));
    expect((await leave(f.paul.userId)).error?.message).toContain("only Owner");
    expect((await leave(f.paul.userId, true)).error?.message).toContain("only Owner");
    // A second Owner: now Paul can leave, and the other Owner is listed to be told.
    ok(await f.db.from("business_managers").update({ role: "owner" }).eq("business_agent_id", f.business.agent.id).eq("user_id", f.marco.userId));
    const departure = Departure.parse(ok(await leave(f.paul.userId)));
    expect(departure.owners).toEqual([{ id: f.marco.userId, notify: true }]);
    expect(await member(f.eve.userId)).toEqual({ role: "staff", supervisor_id: f.marco.userId });
  });

  it("an Owner's choice not to be told is theirs alone, and set from their own work session", async () => {
    ok(await f.owner.rpc("set_business_departure_notices", { p_enabled: false })); // the login's own session is not a work session for a member...
    const owners = ok(await f.db.from("business_managers").select("user_id, notify_departures").eq("business_agent_id", f.business.agent.id).eq("role", "owner"));
    expect(owners).toEqual([{ user_id: f.business.userId, notify_departures: false }]);
    // Managers and Staff can't set it.
    expect((await f.manager1.rpc("set_business_departure_notices", { p_enabled: false })).error).toBeTruthy();
    expect((await f.worker.rpc("set_business_departure_notices", { p_enabled: false })).error).toBeTruthy();
    const departure = Departure.parse(ok(await leave(f.luca.userId)));
    expect(departure.owners).toEqual([{ id: f.business.userId, notify: false }]);
  });
});
