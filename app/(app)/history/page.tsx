import Link from "next/link";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CATEGORY_LABELS, type FactCategory } from "@/lib/policy/disclosure";
import { formatUsd } from "@/lib/usage/pricing";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
/** Request-time cutoff (server component, rendered per request). */
function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
}
const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

type UsageRow = { task_id: string | null; cost_usd: number; input_tokens: number; output_tokens: number };
const sum = (rows: UsageRow[]) => ({
  calls: rows.length,
  cost: rows.reduce((n, r) => n + Number(r.cost_usd), 0),
  tokens: rows.reduce((n, r) => n + r.input_tokens + r.output_tokens, 0),
});

export default async function HistoryPage() {
  const { agent } = await requireAgent();
  const supabase = await createClient();
  const since = daysAgo(30);
  const [{ data: tasks }, { data: exchanges }, { data: agents }, { data: usage }] = await Promise.all([
    supabase.from("tasks").select("*").order("created_at", { ascending: false }).limit(50),
    supabase.from("task_exchanges").select("*").order("created_at", { ascending: false }).limit(200),
    supabase.from("agents").select("id, handle, avatar"),
    // RLS: usage you caused, plus every call made for your tasks (including other agents' replies).
    supabase.from("llm_usage").select("task_id, cost_usd, input_tokens, output_tokens").gte("created_at", since).limit(5000),
  ]);
  const byId = new Map((agents ?? []).map((a) => [a.id, a]));
  const label = (c: string) => (c === "business_info" ? "Public business info" : CATEGORY_LABELS[c as FactCategory] ?? c);
  const incoming = (exchanges ?? []).filter((e) => e.to_agent === agent.id);

  const usageRows = (usage ?? []) as UsageRow[];
  const usageByTask = new Map<string, UsageRow[]>();
  for (const row of usageRows) if (row.task_id) usageByTask.set(row.task_id, [...(usageByTask.get(row.task_id) ?? []), row]);
  const total = sum(usageRows);
  const completed = (tasks ?? []).filter((t) => ["proposal_ready", "accepted"].includes(t.status) && usageByTask.has(t.id));
  const perCompleted = completed.length ? sum(completed.flatMap((t) => usageByTask.get(t.id) ?? [])).cost / completed.length : null;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/settings" className="text-sm text-accent">‹ Settings</Link>
        <h1 className="mt-1 text-lg font-semibold">Activity</h1>
        <p className="text-xs text-muted">Everything your agent did for you: plans, who it asked, and exactly what it shared.</p>
      </div>
      <section className="card" aria-label="AI usage">
        <h2 className="font-semibold">AI usage (last 30 days)</h2>
        <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
          <div><dt className="hint">Cost</dt><dd className="font-medium" data-testid="usage-total">{formatUsd(total.cost)}</dd></div>
          <div><dt className="hint">AI calls</dt><dd className="font-medium">{total.calls} · {tokens(total.tokens)} tokens</dd></div>
          <div><dt className="hint">Per completed plan</dt><dd className="font-medium">{perCompleted === null ? "—" : formatUsd(perCompleted)}</dd></div>
        </dl>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Tasks you delegated</h2>
        {!tasks?.length && <p className="text-sm text-muted">None yet.</p>}
        <ul className="space-y-3">
          {tasks?.map((t) => {
            const own = (exchanges ?? []).filter((e) => e.task_id === t.id);
            const cost = sum(usageByTask.get(t.id) ?? []);
            return (
              <li key={t.id} className="card text-sm" data-testid="task-history">
                <div className="flex justify-between gap-2">
                  <Link href={`/chats/${t.conversation_id}`} className="font-medium hover:underline">“{t.goal}”</Link>
                  <span className="shrink-0 text-xs text-muted">{t.status.replace("_", " ")}</span>
                </div>
                <p className="text-xs text-muted">
                  {fmt(t.created_at)}
                  {cost.calls > 0 && ` · AI: ${cost.calls} calls, ${tokens(cost.tokens)} tokens, ${formatUsd(cost.cost)}`}
                  {t.attempts > 1 && ` · resumed after ${t.attempts - 1} interruption${t.attempts > 2 ? "s" : ""}`}
                </p>
                {t.error && <p className="text-xs text-danger">{t.error}</p>}
                <ul className="mt-2 space-y-1 text-xs">
                  {own.map((e) => (
                    <li key={e.id}>
                      → {byId.get(e.to_agent ?? "")?.avatar} @{byId.get(e.to_agent ?? "")?.handle}: {e.status === "waiting_human" ? "waiting for them to answer" : e.status}{e.answered_by === "human" && " (answered personally)"}
                      {e.latency_ms ? ` · ${(e.latency_ms / 1000).toFixed(1)}s` : ""}
                      {e.disclosed_categories.length > 0 && ` · they shared: ${e.disclosed_categories.map(label).join(", ")}`}
                      {e.error && ` · ${e.error}`}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2 className="mb-1 font-semibold">What your agent shared with others</h2>
        <p className="mb-2 text-xs text-muted">Every request other agents sent to @{agent.handle}, and exactly which of your information was used to answer.</p>
        {!incoming.length && <p className="text-sm text-muted">Nothing yet.</p>}
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface empty:hidden">
          {incoming.map((e) => {
            const from = e.from_agent ? byId.get(e.from_agent) : undefined;
            return (
              <li key={e.id} className="px-4 py-3 text-sm" data-testid="disclosure">
                <div className="flex justify-between gap-2">
                  <span>{from ? `${from.avatar} @${from.handle}'s agent` : "An external agent"} · {e.skill}</span>
                  <span className="shrink-0 text-xs text-muted">{fmt(e.created_at)}</span>
                </div>
                <p className="text-xs text-muted">
                  {e.status === "completed"
                    ? e.disclosed_categories.length
                      ? `Shared: ${e.disclosed_categories.map(label).join(", ")}${e.answered_by === "human" ? " (you answered personally)" : ""}`
                      : "Shared nothing"
                    : e.status === "waiting_human"
                      ? "Waiting for your answer in My Agent: nothing shared yet"
                      : `${e.status}${e.error ? ` (${e.error})` : ""} — nothing shared`}
                </p>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
