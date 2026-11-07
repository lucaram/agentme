// Founder metrics for the closed beta (section 8 of the MVP plan).
// Usage: npm run metrics [-- --days 14]
import { createClient } from "@supabase/supabase-js";

const days = Number(process.argv[process.argv.indexOf("--days") + 1]) || 30;
const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function all(table, columns, filter = (q) => q) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(db.from(table).select(columns)).range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

const [agents, tasks, proposals, usage] = await Promise.all([
  all("agents", "id, type, created_at"),
  all("tasks", "id, owner_id, status, error, attempts, created_at", (q) => q.gte("created_at", since)),
  all("proposals", "task_id, status", (q) => q.gte("created_at", since)),
  all("llm_usage", "task_id, model, purpose, cost_usd, input_tokens, output_tokens, ok", (q) => q.gte("created_at", since)),
]);

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "—");
const usd = (n) => `$${n.toFixed(4)}`;
const count = (rows, key) => rows.reduce((m, r) => m.set(r[key], (m.get(r[key]) ?? 0) + 1), new Map());

const completed = tasks.filter((t) => ["proposal_ready", "accepted"].includes(t.status));
const costByTask = new Map();
for (const u of usage) if (u.task_id) costByTask.set(u.task_id, (costByTask.get(u.task_id) ?? 0) + Number(u.cost_usd));
const completedCost = completed.reduce((n, t) => n + (costByTask.get(t.id) ?? 0), 0);
const users = new Set(tasks.map((t) => t.owner_id));
const usersWithCompleted = new Set(completed.map((t) => t.owner_id));

console.log(`\nAGENTME metrics — last ${days} days\n`);
console.log(`Agents (all time)          ${agents.length} (${agents.filter((a) => a.type === "business").length} business)`);
console.log(`Users who delegated         ${users.size}; completed ≥1 task: ${usersWithCompleted.size} (${pct(usersWithCompleted.size, agents.length)} of agents)`);
console.log(`Tasks                       ${tasks.length}`);
for (const [status, n] of count(tasks, "status")) console.log(`  ${status.padEnd(24)}  ${n}`);
console.log(`Proposals accepted (shared) ${proposals.filter((p) => p.status === "accepted").length}/${proposals.length} (${pct(proposals.filter((p) => p.status === "accepted").length, proposals.length)})`);
console.log(`Tasks resumed after restart ${tasks.filter((t) => t.attempts > 1).length}`);
console.log(`\nAI cost                     ${usd(usage.reduce((n, u) => n + Number(u.cost_usd), 0))} over ${usage.length} calls (${usage.filter((u) => !u.ok).length} refused)`);
console.log(`AI cost per completed task  ${completed.length ? usd(completedCost / completed.length) : "—"} (${completed.length} tasks)`);
for (const [model, n] of count(usage, "model")) {
  const cost = usage.filter((u) => u.model === model).reduce((s, u) => s + Number(u.cost_usd), 0);
  console.log(`  ${String(model).padEnd(24)}  ${n} calls, ${usd(cost)}`);
}
const failures = count(tasks.filter((t) => t.status === "failed"), "error");
if (failures.size) {
  console.log(`\nWhy tasks failed`);
  for (const [reason, n] of failures) console.log(`  ${n}× ${reason}`);
}
console.log("");
