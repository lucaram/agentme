import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { OpenRequests } from "@/components/requests/OpenRequests";
import { threadStatus, type ThreadGroup } from "@/lib/agents/threads";
import { Composer } from "./Composer";

const GROUPS: { key: ThreadGroup; title: string }[] = [
  { key: "needs", title: "Needs you" },
  { key: "progress", title: "In progress" },
  { key: "recent", title: "Recent" },
];

/**
 * My Agent's home: one line per request (like a list of recent chats), grouped
 * by what they need, newest activity first, each with its own badge. Typing
 * below starts a new request.
 */
export async function MyAgentHome({ conversationId, examples, now }: { conversationId: string; examples: { label: string; text: string }[]; now: number }) {
  const supabase = await createClient();
  const [{ data }, { count: requestsMade }] = await Promise.all([
    supabase.rpc("my_agent_threads"),
    // RLS: your own plans. After a few, the template chips step aside (💡 Ideas brings them back).
    supabase.from("tasks").select("*", { count: "exact", head: true }),
  ]);
  const threads = (data ?? []).map((t) => ({ ...t, ...threadStatus(t, now) }));
  const older = threads.filter((t) => t.group === "older");

  return (
    <div className="flex flex-1 flex-col">
      <RealtimeRefresh channel={`my-agent-${conversationId}`} tables={["messages", "inbox_items"]} filter={`conversation_id=eq.${conversationId}`} />
      {/* New requests start in the box at the bottom (one way to start, not two). */}
      <div className="mb-3">
        <h1 className="text-lg font-semibold">My Agent</h1>
        <p className="text-xs text-muted">
          Your requests, one per line. Tap one to see only its updates, or type below to start a new one. Your agent always asks before contacting
          anyone.
        </p>
      </div>

      <div className="mb-4">
        <OpenRequests title="Needs your answer" kinds={["info_request", "question"]} hint="Only you can decide these. Nothing is shared until you choose." />
      </div>

      {threads.length === 0 && (
        <p className="card text-sm text-muted">No requests yet. Ask your agent something below, e.g. “Arrange dinner with @marco on Saturday evening”.</p>
      )}

      <div className="space-y-5">
        {GROUPS.map(({ key, title }) => {
          const rows = threads.filter((t) => t.group === key);
          if (!rows.length) return null;
          return (
            <section key={key} aria-label={title}>
              <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
              <ThreadList conversationId={conversationId} rows={rows} />
            </section>
          );
        })}
        {older.length > 0 && (
          <details>
            <summary className="text-xs font-semibold uppercase tracking-wide text-muted">Older ({older.length})</summary>
            <div className="mt-1">
              <ThreadList conversationId={conversationId} rows={older} />
            </div>
          </details>
        )}
      </div>

      <div className="flex-1" />
      <Composer conversationId={conversationId} threadId="new" placeholder="Start a new request, e.g. Arrange dinner with @marco on Saturday evening" thinkingLabel="Agent is thinking…" examples={examples} collapseExamples={(requestsMade ?? 0) >= 3} />
    </div>
  );
}

type Row = { id: string; kind: string; title: string; unread: number; label: string | null; preview: string | null };

function ThreadList({ conversationId, rows }: { conversationId: string; rows: Row[] }) {
  return (
    <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
      {rows.map((t) => (
        <li key={t.id}>
          <Link href={`/chats/${conversationId}?t=${t.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-accent-soft" data-testid="agent-thread">
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-sm ${t.unread ? "font-semibold" : "font-medium"}`}>
                {t.kind === "updates" ? "📬 " : ""}
                {t.title}
              </span>
              <span className="block truncate text-xs text-muted">
                {t.label && <span className="text-accent">{t.label}</span>}
                {t.label && t.preview ? " · " : ""}
                {t.preview}
              </span>
            </span>
            {t.unread > 0 && (
              <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-white dark:text-black" aria-label={`${t.unread} new`} data-testid="thread-badge">
                {t.unread > 99 ? "99+" : t.unread}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
