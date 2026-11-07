import Link from "next/link";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CATEGORY_LABELS, type FactCategory } from "@/lib/policy/disclosure";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

export default async function HistoryPage() {
  const { agent } = await requireAgent();
  const supabase = await createClient();
  const [{ data: tasks }, { data: exchanges }, { data: agents }] = await Promise.all([
    supabase.from("tasks").select("*, proposals(status, content)").order("created_at", { ascending: false }).limit(50),
    supabase.from("task_exchanges").select("*").order("created_at", { ascending: false }).limit(200),
    supabase.from("agents").select("id, handle, avatar"),
  ]);
  const byId = new Map((agents ?? []).map((a) => [a.id, a]));
  const label = (c: string) => (c === "business_info" ? "Public business info" : CATEGORY_LABELS[c as FactCategory] ?? c);
  const incoming = (exchanges ?? []).filter((e) => e.to_agent === agent.id);

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-2 font-semibold">Tasks you delegated</h2>
        {!tasks?.length && <p className="text-sm text-muted">None yet.</p>}
        <ul className="space-y-3">
          {tasks?.map((t) => {
            const own = (exchanges ?? []).filter((e) => e.task_id === t.id);
            return (
              <li key={t.id} className="card text-sm">
                <div className="flex justify-between gap-2">
                  <Link href={`/chats/${t.conversation_id}`} className="font-medium hover:underline">“{t.goal}”</Link>
                  <span className="shrink-0 text-xs text-muted">{t.status.replace("_", " ")}</span>
                </div>
                <p className="text-xs text-muted">{fmt(t.created_at)}</p>
                <ul className="mt-2 space-y-1 text-xs">
                  {own.map((e) => (
                    <li key={e.id}>
                      → {byId.get(e.to_agent ?? "")?.avatar} @{byId.get(e.to_agent ?? "")?.handle}: {e.status}
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
                      ? `Shared: ${e.disclosed_categories.map(label).join(", ")}`
                      : "Shared nothing"
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
