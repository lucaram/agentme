import { businessStaffFixture } from "./business-staff";

export async function businessTeamsFixture() {
  const f = await businessStaffFixture(); let extraUser: string | undefined;
  try {
    const handle = `team_eve_${crypto.randomUUID().slice(0, 8)}`; const email = `${handle}@agentme.test`;
    const made = await f.db.auth.admin.createUser({ email, password: f.password, email_confirm: true }); if (made.error) throw made.error; extraUser = made.data.user.id;
    const agent = await f.db.from("agents").insert({ owner_id: extraUser, handle, display_name: "Eve", type: "personal" }).select("*").single(); if (agent.error) throw agent.error;
    const eve = { userId: extraUser, email, agent: agent.data };
    const managers = await f.db.from("business_managers").insert([{ business_agent_id: f.business.agent.id, user_id: f.marco.userId, role: "manager" }, { business_agent_id: f.business.agent.id, user_id: f.paul.userId, role: "manager" }]); if (managers.error) throw managers.error;
    const staff = await f.db.from("business_managers").insert([{ business_agent_id: f.business.agent.id, user_id: f.luca.userId, role: "staff", supervisor_id: f.marco.userId }, { business_agent_id: f.business.agent.id, user_id: eve.userId, role: "staff", supervisor_id: f.paul.userId }]); if (staff.error) throw staff.error;
    const manager1 = await f.signed(f.marco, true); const manager2 = await f.signed(f.paul, true); const worker = await f.signed(f.luca, true); const otherWorker = await f.signed(eve, true);
    const chat = await f.db.from("conversations").insert({ kind: "my_agent", created_by: f.business.userId }).select("id").single(); if (chat.error) throw chat.error;
    const member = await f.db.from("conversation_members").insert({ conversation_id: chat.data.id, user_id: f.business.userId, role: "owner", history_from: "-infinity" }); if (member.error) throw member.error;
    return { ...f, businessChat: chat.data.id, eve, manager1, manager2, worker, otherWorker, cleanup: async () => { await f.db.from("conversations").delete().eq("created_by", eve.userId); await f.db.auth.admin.deleteUser(eve.userId); await f.cleanup(); } };
  } catch (error) { if (extraUser) await f.db.auth.admin.deleteUser(extraUser); await f.cleanup(); throw error; }
}
