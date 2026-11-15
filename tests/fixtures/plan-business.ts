import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/database.types";

/** Isolated accounts and plans; never reseeds or changes the demo users. */
export async function planBusinessFixture() {
  const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const tag = crypto.randomUUID().slice(0, 6);
  const users: string[] = [];
  const password = "case7-test-password";
  const people: { userId: string; email: string; agent: Database["public"]["Tables"]["agents"]["Row"] }[] = [];
  const cleanup = async () => {
    await db.from("conversations").delete().in("created_by", users);
    for (const p of people) await db.from("rate_limits").delete().like("key", `%${p.agent.id}%`);
    for (const id of users) await db.auth.admin.deleteUser(id);
  };
  try {
    for (const name of ["luca", "marco", "paul", "trattoria"]) {
      const handle = `c7${tag}_${name}`;
      const email = `${handle}@agentme.test`;
      const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw error;
      users.push(data.user.id);
      const business = name === "trattoria";
      const { data: agent, error: agentError } = await db.from("agents").insert({
        owner_id: data.user.id, handle, display_name: business ? "Trattoria Sole" : name[0].toUpperCase() + name.slice(1),
        type: business ? "business" : "personal", contact_policy: "anyone",
        business_info: business ? { hours: "Closed Mondays. Open Tuesday to Sunday.", ways: [{ kind: "book", value: "https://sole.example/book" }, { kind: "email", value: "bookings@sole.example" }, { kind: "call", value: "020 7946 0000" }], faqs: [{ q: "Are you open on Mondays?", a: "We are closed Mondays." }, { q: "Do you take group bookings?", a: "Please call 020 7946 0000 to book." }] } : {},
      }).select("*").single();
      if (agentError) throw agentError;
      people.push({ userId: data.user.id, email, agent: agent! });
    }
    const [luca, marco, paul, business] = people;
    const conversation = async (kind: "my_agent" | "group" | "agent_chat", target?: string) => {
      const { data, error } = await db.from("conversations").insert({ kind, created_by: luca.userId, target_agent: target ?? null }).select("id").single();
      if (error) throw error;
      const members = kind === "group" ? [luca, marco, paul] : [luca];
      // This fixture represents already-established memberships, including historical message tests.
      const { error: memberError } = await db.from("conversation_members").insert(members.map((p) => ({ conversation_id: data!.id, user_id: p.userId, role: p === luca ? "owner" : "member", history_from: "-infinity" })));
      if (memberError) throw memberError;
      return data!.id;
    };
    const myAgent = await conversation("my_agent");
    const group = await conversation("group");
    const direct = await conversation("agent_chat", business.agent.id);
    const venue = { agent_id: business.agent.id, handle: business.agent.handle, name: business.agent.display_name };
    const { data: task, error: taskError } = await db.from("tasks").insert({
      owner_id: luca.userId, initiator_agent: luca.agent.id, conversation_id: myAgent, group_conversation_id: group,
      status: "completed", goal: "Saturday Italian Dinner", parsed: { kind: "coordinate", event: "dinner", participants: [marco.agent.handle, paul.agent.handle], venue },
    }).select("id").single();
    if (taskError) throw taskError;
    const { error: proposalError } = await db.from("proposals").insert({ task_id: task!.id, status: "accepted", group_conversation_id: group,
      content: { title: "Saturday Italian Dinner", day: "Saturday 21 November 2026", time: "19:00", participants: [luca.agent.handle, marco.agent.handle, paul.agent.handle], venue },
    });
    if (proposalError) throw proposalError;
    const { data: step, error: stepError } = await db.from("plan_steps").insert({ task_id: task!.id, position: 0, type: "rsvp", status: "done", config: {} }).select("id").single();
    if (stepError) throw stepError;
    const { error: rsvpError } = await db.from("step_responses").insert([luca, marco, paul].map((p) => ({ step_id: step!.id, agent_id: p.agent.id, value: { response: "in" } })));
    if (rsvpError) throw rsvpError;
    return { db, password, luca, marco, paul, business, myAgent, group, direct, taskId: task!.id, stepId: step!.id, venue, cleanup };
  } catch (e) { await cleanup(); throw e; }
}
