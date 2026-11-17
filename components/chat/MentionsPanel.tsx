"use client";
import { Avatar } from "@/components/Avatar";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { MentionPage, type MentionState } from "@/lib/chat/mentions";
import { ChatDialog } from "./ChatDialog";
import { LocalTime } from "@/components/LocalTime";

function pageUrl(last?: MentionPage["items"][number]) { return last ? `/api/mentions/list?before=${encodeURIComponent(last.created_at)}&message=${last.message_id}` : "/api/mentions/list"; }
async function loadPage(url: string, signal: AbortSignal) { const response = await fetch(url, { cache: "no-store", signal }); if (!response.ok) throw new Error(); return MentionPage.parse(await response.json()); }

export function MentionsPanel({ state, onClose }: { state: MentionState | null; onClose: () => void }) {
  const [data, setData] = useState<MentionPage>({ items: [], hasMore: false }); const [busy, setBusy] = useState(true); const [error, setError] = useState(""); const [attempt, setAttempt] = useState(0);
  const pages = useRef(1); const moreAbort = useRef<AbortController | null>(null);
  const refreshKey = JSON.stringify([state?.total, state?.chats, state?.alerts.map((item) => item.message_id)]);
  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      let next = await loadPage(pageUrl(), abort.signal); const items = [...next.items];
      for (let page = 1; page < pages.current && next.hasMore; page++) { next = await loadPage(pageUrl(items.at(-1)), abort.signal); items.push(...next.items); }
      if (!abort.signal.aborted) { setData({ items: [...new Map(items.map((item) => [item.message_id, item])).values()], hasMore: next.hasMore }); setError(""); }
    })().catch(() => { if (!abort.signal.aborted) setError("Couldn't load mentions. Try again."); }).finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => { abort.abort(); moreAbort.current?.abort(); moreAbort.current = null; };
  }, [refreshKey, attempt]);
  async function more() {
    if (busy || moreAbort.current) return; const abort = new AbortController(); moreAbort.current = abort; setBusy(true); setError("");
    try { const next = await loadPage(pageUrl(data.items.at(-1)), abort.signal); if (!abort.signal.aborted) { pages.current++; setData((old) => ({ items: [...new Map([...old.items, ...next.items].map((item) => [item.message_id, item])).values()], hasMore: next.hasMore })); } }
    catch { if (!abort.signal.aborted) setError("Couldn't load more mentions. Try again."); }
    finally { if (!abort.signal.aborted) { moreAbort.current = null; setBusy(false); } }
  }
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; items: MentionPage["items"] }>();
    for (const item of data.items) { const group = map.get(item.conversation_id) ?? { name: item.chat_name, items: [] }; group.items.push(item); map.set(item.conversation_id, group); } return [...map];
  }, [data.items]);
  const total = state?.total ?? state?.chats.reduce((n, chat) => n + chat.total, 0) ?? data.items.length;
  return <ChatDialog label="Unread mentions" presentation="sheet" onClose={onClose}>
    <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-surface px-5 py-4"><div><h2 className="font-semibold">Mentions</h2><p className="text-xs text-muted">{total} unread</p></div><button type="button" className="rounded-full px-2 py-1 text-muted hover:bg-accent-soft" aria-label="Close mentions" onClick={onClose}>✕</button></div>
    <div className="space-y-4 p-4" aria-busy={busy}>
      {groups.map(([id, group]) => <section key={id} className="overflow-hidden rounded-2xl border border-border" aria-label={group.name}><div className="flex items-center justify-between gap-3 bg-accent-soft px-3 py-2"><h3 className="truncate text-sm font-semibold">{group.name}</h3><span className="text-xs tabular-nums">{state?.chats.find((chat) => chat.conversation_id === id)?.total ?? group.items.length}</span></div><ul className="divide-y divide-border">{group.items.map((item) => <li key={item.message_id}><Link href={`/chats/${item.conversation_id}#m-${item.message_id}`} aria-label={`View mention from ${item.sender} in ${item.chat_name}`} className="flex gap-3 px-3 py-3 hover:bg-accent-soft" onClick={onClose} data-testid="unread-mention"><span aria-hidden className="text-2xl"><Avatar value={item.avatar} /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{item.sender}</span><span className="mt-0.5 block break-words text-sm">{item.preview}</span><span className="mt-1 block text-[11px] text-muted"><LocalTime iso={item.created_at} full /></span></span></Link></li>)}</ul></section>)}
      {busy && <p role="status" className="text-sm text-muted">Loading mentions…</p>}{!busy && !error && !data.items.length && <p className="py-4 text-center text-sm text-muted">No unread mentions.</p>}
      {error && <div className="space-y-2"><p role="alert" className="text-sm text-danger">{error}</p><button type="button" className="btn-secondary" onClick={() => { setBusy(true); setAttempt((n) => n + 1); }}>Retry</button></div>}
      {data.hasMore && <button type="button" className="btn-secondary w-full" disabled={busy} onClick={() => void more()}>Load more mentions</button>}
    </div>
  </ChatDialog>;
}
