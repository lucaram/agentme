import type { planBusinessFixture } from "./plan-business";

/** Real topic rows and tasks, isolated inside the caller's throwaway account. */
export async function agentTopicsFixture(f: Awaited<ReturnType<typeof planBusinessFixture>>) {
  const now = Date.now();
  const rows = ([{ name: "Recent", count: 25, age: 60_000 }, { name: "Progress", count: 23, age: 120_000 }, { name: "Approval", count: 2, age: 180_000 }, { name: "History", count: 13, age: 10 * 86400_000 }] as const).flatMap((group) => Array.from({ length: group.count }, (_, i) => ({ id: crypto.randomUUID(), owner_id: f.luca.userId, conversation_id: f.myAgent, title: `${group.name} topic ${String(i + 1).padStart(2, "0")}`, renamed: true, last_activity_at: new Date(now - group.age - i * 1000).toISOString(), last_read_at: new Date(now - 20 * 86400_000).toISOString() })));
  const inserted = await f.db.from("agent_threads").insert(rows); if (inserted.error) throw inserted.error;
  const messages = await f.db.from("messages").insert(rows.map((row) => ({ conversation_id: f.myAgent, thread_id: row.id, sender_agent_id: f.luca.agent.id, content: `Update for ${row.title}`, is_ai_generated: true, created_at: row.last_activity_at }))); if (messages.error) throw messages.error;
  const planned = rows.filter((row) => /^(Progress|Approval)/.test(row.title));
  const tasks = planned.map((row) => ({ id: crypto.randomUUID(), owner_id: f.luca.userId, initiator_agent: f.luca.agent.id, conversation_id: f.myAgent, goal: row.title, parsed: {}, status: row.title.startsWith("Approval") ? "awaiting_approval" as const : "waiting" as const }));
  const saved = await f.db.from("tasks").insert(tasks); if (saved.error) throw saved.error;
  const links = await f.db.from("agent_thread_tasks").insert(tasks.map((task, i) => ({ task_id: task.id, thread_id: planned[i].id }))); if (links.error) throw links.error;
  return { rows, tasks };
}
