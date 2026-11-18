import { Avatar } from "@/components/Avatar";
import Link from "next/link";
import { OUTCOMES, describeIncoming, type Outcome } from "@/lib/activity/incoming";
import { getOrCreateMyAgentConversation } from "@/lib/data/chat";
import { LoadMore } from "@/components/LoadMore";
import { PAGE_SIZE as PAGE } from "@/lib/paging";
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


export default async function HistoryPage({ searchParams }: PageProps<"/history">) {
  const { user, agent } = await requireAgent();
  const { show: rawShow, n: rawCount } = await searchParams;
  const show = (OUTCOMES.some((o) => o.id === rawShow) ? rawShow : "all") as Outcome | "all";
  const count = Math.min(200, Math.max(PAGE, Number(rawCount) || PAGE));
  const supabase = await createClient();
  const since = daysAgo(30);
  const [{ data: tasks }, { data: exchanges }, { data: received }, { data: agents }, { data: usage }] = await Promise.all([
    supabase.from("tasks").select("*").order("created_at", { ascending: false }).limit(50),
    supabase.from("task_exchanges").select("*").order("created_at", { ascending: false }).limit(200),
    supabase.from("task_exchanges").select("*").eq("to_agent", agent.id).order("created_at", { ascending: false }).limit(200),
    supabase.from("agents").select("id, handle, avatar, display_name"),
    // RLS: usage you caused, plus every call made for your tasks (including other agents' replies).
    supabase.from("llm_usage").select("task_id, cost_usd, input_tokens, output_tokens").gte("created_at", since).limit(5000),
  ]);
  const byId = new Map((agents ?? []).map((a) => [a.id, a]));
  const label = (c: string) => (c === "business_info" ? "Public business info" : CATEGORY_LABELS[c as FactCategory] ?? c);
  // What others asked: in plain words, waiting ones first; the summary covers the last 30 days.
  const incoming = (received ?? []).map((e) => ({ ...e, row: describeIncoming(e) }));
  const recent = incoming.filter((e) => e.created_at >= since);
  const tally = (outcome: Outcome) => recent.filter((e) => e.row.outcome === outcome).length;
  const listed = incoming
    .filter((e) => show === "all" || e.row.outcome === show)
    .sort((a, b) => Number(b.row.outcome === "waiting") - Number(a.row.outcome === "waiting"));
  const myAgent = incoming.some((e) => e.row.outcome === "waiting") ? await getOrCreateMyAgentConversation(user.id) : null;
  const business = agent.type === "business";
  const href = (next: { show?: string; n?: number }) => {
    const params = new URLSearchParams();
    const nextShow = next.show ?? show;
    if (nextShow !== "all") params.set("show", nextShow);
    if (next.n && next.n > PAGE) params.set("n", String(next.n));
    // A filter jumps to the list; more rows load in place.
    return `/history${params.size ? `?${params}` : ""}${next.n ? "" : "#asked"}`;
  };

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
                      → <Avatar value={byId.get(e.to_agent ?? "")?.avatar} /> @{byId.get(e.to_agent ?? "")?.handle}: {e.status === "waiting_human" ? "waiting for them to answer" : e.status}{e.answered_by === "human" && " (answered personally)"}
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

      <section id="asked" className="scroll-mt-40" aria-labelledby="asked-title">
        <h2 id="asked-title" className="mb-1 font-semibold">{business ? "Questions customers asked" : "What your agent shared with others"}</h2>
        <p className="mb-2 text-xs text-muted">
          {business ? `What customers' agents asked @${agent.handle}, and what they were told.` : "What other people's agents asked, and exactly what your agent told them."}
        </p>
        {incoming.length > 0 && (
          <>
            <p className="mb-2 text-sm" data-testid="asked-summary">
              Last 30 days: {recent.length} {business ? (recent.length === 1 ? "question" : "questions") : recent.length === 1 ? "request" : "requests"} · {tally("agent")} by your agent · {tally("you")} by you
              {tally("waiting") > 0 && <> · <b className="text-accent">{tally("waiting")} waiting for you</b></>}
            </p>
            <nav aria-label="Show" className="no-scrollbar mb-3 flex gap-1 overflow-x-auto">
              {OUTCOMES.map((o) => (
                <Link key={o.id} href={href({ show: o.id })} aria-current={show === o.id ? "true" : undefined} className={`shrink-0 rounded-full border px-3 py-1 text-xs ${show === o.id ? "border-accent bg-accent-soft font-medium" : "border-border text-muted hover:bg-accent-soft"}`}>
                  {o.label}
                </Link>
              ))}
            </nav>
          </>
        )}
        {!listed.length && <p className="text-sm text-muted">{incoming.length ? "Nothing here." : "Nothing yet."}</p>}
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface empty:hidden">
          {listed.slice(0, count).map((e) => {
            const from = e.from_agent ? byId.get(e.from_agent) : undefined;
            const { row } = e;
            const waiting = row.outcome === "waiting";
            return (
              <li key={e.id} className={`space-y-1 px-4 py-3 text-sm ${waiting ? "bg-accent-soft/60" : ""}`} data-testid="disclosure">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {waiting && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />}
                    <Avatar value={from?.avatar} />
                    <span className="truncate font-medium">{from?.display_name ?? "An agent outside AGENTME"}</span>
                    <span className="shrink-0 text-xs text-muted">· {fmt(e.created_at)}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs">
                    <span className={waiting ? "font-medium text-accent" : "text-muted"} data-testid="outcome">{row.outcomeText}</span>
                    {waiting && myAgent && <Link href={`/chats/${myAgent.id}`} className="btn-primary px-3 py-1 text-xs">Answer</Link>}
                  </span>
                </div>
                {row.asked && (
                  <p>
                    {row.plan ? <><span className="text-muted">Asked about: </span>{row.asked}</> : <>“{row.asked}”</>}
                  </p>
                )}
                {row.shared.length > 0 && (
                  <p className="text-xs" data-testid="shared">
                    <span className="text-muted">Shared: </span>
                    {row.shared.map((item, i) => <span key={item.label}>{i > 0 && " · "}{item.label}: <i>{item.value}</i></span>)}
                  </p>
                )}
                {row.answer && (
                  row.answer.length > 160 ? (
                    <details className="group text-muted">
                      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                        <span className="line-clamp-2 group-open:line-clamp-none">→ {row.answer}</span>
                        <span className="text-xs text-accent group-open:hidden">Show all</span>
                      </summary>
                    </details>
                  ) : (
                    <p className="text-muted">→ {row.answer}</p>
                  )
                )}
              </li>
            );
          })}
        </ul>
        {listed.length > count && (
          <LoadMore href={href({ n: count + PAGE })} left={listed.length - count} />
        )}
      </section>
    </div>
  );
}
