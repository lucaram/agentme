/**
 * Finding people: mutual-only matching, phone verification, introductions,
 * plan invite links, and what the browser may read (RLS).
 * Uses its own throwaway users (deleted afterwards), never the demo accounts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, SUPABASE_URL, admin, dbUp } from "./env";

type Person = { handle: string; email: string; userId: string; agent: Awaited<ReturnType<typeof import("@/lib/data/agents").getAgentById>> & object };
const run = Math.random().toString(36).slice(2, 8);
const people: Record<"a" | "b" | "c" | "d", Person> = {} as never;
const PASSWORD = "people-test-password";

const lib = async () => ({
  matching: await import("@/lib/people/matching"),
  intro: await import("@/lib/people/introductions"),
  invites: await import("@/lib/plans/invites"),
  chat: await import("@/lib/data/chat"),
});
const contactBetween = async (x: Person, y: Person) =>
  (
    await admin()
      .from("contacts")
      .select("*")
      .or(`and(requester_agent.eq.${x.agent.id},addressee_agent.eq.${y.agent.id}),and(requester_agent.eq.${y.agent.id},addressee_agent.eq.${x.agent.id})`)
      .maybeSingle()
  ).data;
const befriend = (x: Person, y: Person) => admin().from("contacts").insert({ requester_agent: x.agent.id, addressee_agent: y.agent.id, status: "accepted" });
const suggestedHandles = async (p: Person) => (await (await lib()).matching.mutualSuggestions(p.agent.id)).map((s) => s.handle);
const confirmed = (p: Person) => ({ email: p.email, emailConfirmed: true });

describe.skipIf(!dbUp)("finding people (live)", () => {
  beforeAll(async () => {
    const db = admin();
    for (const key of ["a", "b", "c", "d"] as const) {
      const handle = `tp${run}_${key}`;
      const email = `${handle}@people.test`;
      const { data: created, error } = await db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      if (error) throw error;
      const { data: agent } = await db
        .from("agents")
        .insert({ owner_id: created.user.id, handle, display_name: `Test ${key.toUpperCase()}`, avatar: "🦊" })
        .select("*")
        .single();
      people[key] = { handle, email, userId: created.user.id, agent: agent! };
    }
  });

  afterAll(async () => {
    const db = admin();
    const ids = Object.values(people).map((p) => p.userId);
    await db.from("conversations").delete().in("created_by", ids);
    for (const id of ids) await db.auth.admin.deleteUser(id);
  });

  it("suggests someone only when BOTH have each other, and never reveals one-sided matches", async () => {
    const { matching } = await lib();
    const { a, b } = people;
    await matching.registerAccountEmail(a.agent.id, confirmed(a));
    await matching.registerAccountEmail(b.agent.id, confirmed(b));

    const first = await matching.syncAddressBook(a.agent, [b.email, "someone-not-on-agentme@example.com"], null);
    expect(first).toEqual({ ok: true, checked: 2 }); // a count of entries, never of matches
    expect(await suggestedHandles(a)).toEqual([]);
    expect(await suggestedHandles(b)).toEqual([]);

    await matching.syncAddressBook(b.agent, [`  ${a.email.toUpperCase()} `], null);
    expect(await suggestedHandles(a)).toEqual([b.handle]);
    expect(await suggestedHandles(b)).toEqual([a.handle]);

    // Non-matching entries are not kept anywhere.
    const { data: kept } = await admin().from("address_book_matches").select("matched_agent").eq("owner_agent", a.agent.id);
    expect(kept).toEqual([{ matched_agent: b.agent.id }]);

    // Forgetting your contacts removes the suggestion on both sides.
    await matching.clearAddressBook(a.agent.id);
    expect(await suggestedHandles(b)).toEqual([]);
    await matching.syncAddressBook(a.agent, [b.email], null);
    expect(await suggestedHandles(b)).toEqual([a.handle]);

    // Once connected (or blocked) they're no longer suggested.
    await befriend(a, b);
    expect(await suggestedHandles(a)).toEqual([]);
    await admin().from("contacts").delete().eq("requester_agent", a.agent.id).eq("addressee_agent", b.agent.id);
  });

  it("phone numbers count only after a code proves them, and belong to the newest owner", async () => {
    const { matching } = await lib();
    const { a, b, c } = people;
    const number = `+44 7700 9${String(Math.floor(Math.random() * 1e5)).padStart(5, "0")}`;
    const started = await matching.startPhoneVerification(a.agent, number);
    expect(started.ok).toBe(true);
    const code = (started as { devCode: string }).devCode;
    expect(code).toMatch(/^\d{6}$/);
    const wrong = code === "000000" ? "111111" : "000000";
    expect(await matching.confirmPhone(a.agent, number, wrong)).toEqual({ ok: false, error: "That code isn't right." });
    expect(await matching.confirmPhone(a.agent, number, code)).toEqual({ ok: true });
    const { data: aPhone } = await admin().from("agent_identifiers").select("hint").eq("agent_id", a.agent.id).eq("kind", "phone").single();
    expect(aPhone!.hint).toBe(`+44 ••• ${number.slice(-4)}`);

    // b proves the same (recycled) number: it moves to b.
    const again = await matching.startPhoneVerification(b.agent, number);
    expect(await matching.confirmPhone(b.agent, number, (again as { devCode: string }).devCode)).toEqual({ ok: true });
    expect((await admin().from("agent_identifiers").select("*").eq("agent_id", a.agent.id).eq("kind", "phone")).data).toEqual([]);

    // c saved it in local format: still matches b.
    await matching.syncAddressBook(c.agent, [number.replace("+44 ", "0")], "+44");
    const { data: edge } = await admin().from("address_book_matches").select("matched_agent").eq("owner_agent", c.agent.id);
    expect(edge).toEqual([{ matched_agent: b.agent.id }]);
    await matching.clearAddressBook(c.agent.id);
    await matching.removePhone(b.agent.id);
  });

  it("introductions connect two people only when both say yes", async () => {
    const { intro } = await lib();
    const { a, b, c, d } = people;
    // c knows everyone; a and b don't know each other.
    await befriend(c, a);
    await befriend(c, b);
    await befriend(c, d);
    expect(await intro.createIntroduction(a.agent, b.handle, d.handle, null)).toEqual({ ok: false, error: "You can only introduce people who are both your contacts." });

    expect(await intro.createIntroduction(c.agent, a.handle, b.handle, "you both like climbing")).toEqual({ ok: true });
    const itemFor = async (p: Person) =>
      (await admin().from("inbox_items").select("*").eq("owner_id", p.userId).eq("kind", "introduction").order("created_at", { ascending: false }).limit(1).single()).data!;
    const [itemA, itemB] = [await itemFor(a), await itemFor(b)];
    expect(itemA.payload).toMatchObject({ other_agent: b.agent.id, note: "you both like climbing" });

    expect(await intro.answerIntroduction(itemA.id, a.userId, true)).toEqual({ ok: true });
    expect(await contactBetween(a, b)).toBeNull(); // not until both agree
    // Someone else can't answer for b.
    expect(await intro.answerIntroduction(itemB.id, a.userId, true)).toEqual({ ok: false, error: "Not found." });
    const done = await intro.answerIntroduction(itemB.id, b.userId, true);
    expect(done.ok && done.chatId).toBeTruthy();
    expect((await contactBetween(a, b))?.status).toBe("accepted");
    const { data: note } = await admin().from("messages").select("content").eq("conversation_id", (done as { chatId: string }).chatId);
    expect(note!.map((m) => m.content)).toContain("🤝 Test C introduced you. Say hi!");

    // A "no" quietly closes it for the other person too.
    expect(await intro.createIntroduction(c.agent, a.handle, d.handle, null)).toEqual({ ok: true });
    const [itemA2, itemD] = [await itemFor(a), await itemFor(d)];
    expect(await intro.answerIntroduction(itemD.id, d.userId, false)).toEqual({ ok: true });
    expect((await admin().from("inbox_items").select("status").eq("id", itemA2.id).single()).data!.status).toBe("withdrawn");
    expect(await contactBetween(a, d)).toBeNull();

    // Already connected: nothing is sent, and the introducer can't tell the difference.
    const before = (await admin().from("inbox_items").select("id").eq("owner_id", a.userId)).data!.length;
    expect(await intro.createIntroduction(c.agent, a.handle, b.handle, null)).toEqual({ ok: true });
    expect((await admin().from("inbox_items").select("id").eq("owner_id", a.userId)).data!.length).toBe(before);
  });

  it("an invite link adds someone to the plan, its poll and its group, and connects them with the organiser", async () => {
    const { invites, chat } = await lib();
    const { a, b, d } = people;
    const db = admin();
    const own = await chat.getOrCreateMyAgentConversation(a.userId);
    const group = await chat.createConversation({ kind: "group", title: "Picnic", createdBy: a.userId, memberIds: [b.userId] });
    const { data: task } = await db
      .from("tasks")
      .insert({
        owner_id: a.userId,
        initiator_agent: a.agent.id,
        conversation_id: own.id,
        goal: "Picnic on Sunday",
        status: "waiting",
        group_conversation_id: group.id,
        parsed: { kind: "poll", event: "Picnic", window: "Sunday", participants: [b.handle], categories: [] },
      })
      .select("id")
      .single();
    await db.from("plan_steps").insert({ task_id: task!.id, position: 0, type: "poll", status: "waiting", config: { question: "Where?", options: ["Park", "Beach"], voters: [a.handle, b.handle] } });

    expect(await invites.getOrCreateInvite(task!.id, b.userId)).toEqual({ ok: false, error: "Only the organiser can invite people." });
    const created = await invites.getOrCreateInvite(task!.id, a.userId);
    expect(created.ok).toBe(true);
    const url = (created as { url: string }).url;
    expect(await invites.getOrCreateInvite(task!.id, a.userId)).toEqual({ ok: true, url }); // the same link again
    const token = url.split("/join/")[1];
    expect(await invites.loadInvite(token)).toMatchObject({ title: "Picnic", when: "Sunday", people: 2, conversationId: group.id });
    expect(await invites.loadInvite("x".repeat(22))).toBeNull();

    expect(await invites.joinPlan(token, d.userId, d.agent)).toEqual({ ok: true, conversationId: group.id });
    const { data: after } = await db.from("tasks").select("parsed").eq("id", task!.id).single();
    expect((after!.parsed as { participants: string[] }).participants).toEqual([b.handle, d.handle]);
    const { data: step } = await db.from("plan_steps").select("config").eq("task_id", task!.id).single();
    expect((step!.config as { voters: string[] }).voters).toEqual([a.handle, b.handle, d.handle]);
    expect(await chat.isMember(group.id, d.userId)).toBe(true);
    expect((await contactBetween(a, d))?.status).toBe("accepted");

    // Joining twice changes nothing and posts nothing new.
    await invites.joinPlan(token, d.userId, d.agent);
    const { data: notes } = await db.from("messages").select("content").eq("conversation_id", group.id).like("content", "%joined with the invite link%");
    expect(notes).toHaveLength(1);

    // Turned off: the link stops working.
    await invites.revokeInvites(task!.id, a.userId);
    expect(await invites.loadInvite(token)).toBeNull();
  });

  it("the browser can read only its own identifiers, and none of the matching or invite tables", async () => {
    const { a, b } = people;
    const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await client.auth.signInWithPassword({ email: a.email, password: PASSWORD });
    const own = await client.from("agent_identifiers").select("agent_id");
    expect(new Set(own.data!.map((r) => r.agent_id))).toEqual(new Set([a.agent.id]));
    expect((await client.from("agent_identifiers").select("*").eq("agent_id", b.agent.id)).data).toEqual([]);
    expect((await client.from("address_book_matches").select("*")).data).toEqual([]);
    expect((await client.from("plan_invites").select("*")).data).toEqual([]);
    expect((await client.from("phone_verifications").select("*")).data).toEqual([]);
    // And can't write them directly.
    const write = await client.from("address_book_matches").insert({ owner_agent: a.agent.id, matched_agent: b.agent.id });
    expect(write.error).not.toBeNull();
    const rpc = await client.rpc("add_plan_participant", { p_task: a.agent.id, p_handle: a.handle, p_max: 20 });
    expect(rpc.error).not.toBeNull();
  });
});
