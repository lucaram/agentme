"use client";
import { Avatar } from "@/components/Avatar";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { browserClient } from "@/lib/supabase/client";
import { MENTION_EVENT, OPEN_MENTIONS, MentionState } from "@/lib/chat/mentions";
import { EMPTY_MENTION_BATCH, MENTION_BANNER_MS, mentionBatchLabel, mergeMentionBatch } from "@/lib/chat/mention-batch";
import { READ_EVENT } from "@/components/ChatsBadge";
import { MentionsPanel } from "./MentionsPanel";

export function MentionsButton() {
  const [total, setTotal] = useState(0);
  useEffect(() => { const update = (event: Event) => { const state = (event as CustomEvent<MentionState>).detail; setTotal(state.total ?? state.chats.reduce((n, chat) => n + chat.total, 0)); }; window.addEventListener(MENTION_EVENT, update); return () => window.removeEventListener(MENTION_EVENT, update); }, []);
  return <button type="button" title="Mentions" aria-label={`Mentions, ${total} unread`} aria-haspopup="dialog" className="flex items-center gap-1 rounded-full px-2 py-1 text-sm text-accent hover:bg-accent-soft" data-testid="mentions-button" onClick={() => window.dispatchEvent(new Event(OPEN_MENTIONS))}><span aria-hidden className="font-semibold">@</span>{total > 0 && <span className="rounded-full bg-accent-soft px-1.5 text-[10px] font-semibold tabular-nums">{total > 99 ? "99+" : total}</span>}</button>;
}

function highlight(id: string) {
  let tries = 0; const apply = () => { const row = document.getElementById(`m-${id}`); if (row) { row.classList.add("mention-highlight"); setTimeout(() => row.classList.remove("mention-highlight"), 1800); } else if (++tries < 10) setTimeout(apply, 150); }; apply();
}

/** The banner is a batch of new arrivals. The inbox owns persistent unread state. */
export function MentionCenter({ userId }: { userId: string }) {
  const path = usePathname(); const active = useRef(path); const reloadRef = useRef<(() => void) | null>(null);
  const [state, setState] = useState<MentionState | null>(null); const [batch, setBatch] = useState(EMPTY_MENTION_BATCH); const batchRef = useRef(batch);
  const [open, setOpen] = useState(false); const [hovered, setHovered] = useState(false); const [focused, setFocused] = useState(false); const [visible, setVisible] = useState(true); const banner = useRef<HTMLElement>(null);
  const interacting = hovered || focused;
  const clock = useRef({ generation: -1, remaining: MENTION_BANNER_MS });
  const dismiss = () => { setBatch((old) => old.items.length ? { items: [], generation: old.generation } : old); setHovered(false); setFocused(false); };
  const openPanel = () => { dismiss(); setOpen(true); };
  useLayoutEffect(() => { batchRef.current = batch; active.current = path; }, [batch, path]);
  useEffect(() => { reloadRef.current?.(); }, [path]);
  useLayoutEffect(() => {
    const position = () => { if (banner.current) banner.current.style.top = `${innerWidth < 640 ? Math.max(8, (document.querySelector("header")?.getBoundingClientRect().bottom ?? 80) + 8) : 16}px`; };
    position(); window.addEventListener("resize", position); return () => window.removeEventListener("resize", position);
  }, [batch.items.length]);
  const hasItems = batch.items.length > 0;
  useEffect(() => {
    if (!hasItems) return;
    if (clock.current.generation !== batch.generation) clock.current = { generation: batch.generation, remaining: MENTION_BANNER_MS };
    if (interacting || !visible || open) return;
    const started = performance.now(); const timer = setTimeout(() => setBatch((old) => ({ items: [], generation: old.generation })), clock.current.remaining);
    return () => { clearTimeout(timer); clock.current.remaining = Math.max(0, clock.current.remaining - (performance.now() - started)); };
  }, [batch.generation, hasItems, interacting, visible, open]);
  useEffect(() => {
    const client = browserClient(); const abort = new AbortController(); const announced = new Set<string>(); let busy = false; let again = false; let live = true;
    const reload = async () => {
      if (busy) { again = true; return; } busy = true; let drain = false;
      try {
        const claim = document.visibilityState === "visible"; const known = batchRef.current.items.map((item) => item.message_id).slice(0, 1000);
        const response = await fetch("/api/mentions", { method: claim ? "POST" : "GET", ...(claim ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ known }) } : {}), cache: "no-store", signal: abort.signal });
        if (!response.ok || !live) return; const next = MentionState.parse(await response.json()); if (!live) return;
        setState(next); window.dispatchEvent(new CustomEvent(MENTION_EVENT, { detail: next }));
        const chatId = active.current.match(/^\/chats\/([0-9a-f-]{36})$/)?.[1]; const arrivals = next.alerts.filter((item) => !announced.has(item.message_id));
        for (const item of arrivals) { announced.add(item.message_id); if (item.conversation_id === chatId) highlight(item.message_id); }
        while (announced.size > 2000) announced.delete(announced.values().next().value!);
        setBatch((old) => mergeMentionBatch(old, arrivals, chatId, claim ? known : [], claim ? next.active_ids ?? known : []));
        drain = claim && Boolean(next.more_alerts);
      } catch { /* Retry on reconnect, focus or the next metadata change. */ }
      finally { busy = false; if ((again || drain) && live) { again = false; void reload(); } }
    };
    const refresh = () => { void reload(); }; const visibility = () => { setVisible(document.visibilityState === "visible"); refresh(); }; const show = () => { setOpen(true); setHovered(false); setFocused(false); setBatch((old) => ({ items: [], generation: old.generation })); refresh(); };
    reloadRef.current = refresh;
    const channel = client.channel(`mention-notifications-${userId}`).on("postgres_changes", { event: "*", schema: "public", table: "mention_versions", filter: `user_id=eq.${userId}` }, refresh);
    void client.auth.getSession().then(async ({ data }) => { if (!live) return; if (data.session) await client.realtime.setAuth(data.session.access_token); if (live) channel.subscribe((status) => { if (status === "SUBSCRIBED") refresh(); }); });
    // Let mount settle before claiming a banner: Strict Mode replays effects and
    // an aborted first fetch can otherwise consume the server's one-time claim.
    const initialRefresh = setTimeout(refresh, 0); const interval = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", visibility); window.addEventListener(READ_EVENT, refresh); window.addEventListener(OPEN_MENTIONS, show);
    return () => { live = false; abort.abort(); reloadRef.current = null; clearTimeout(initialRefresh); clearInterval(interval); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", visibility); window.removeEventListener(READ_EVENT, refresh); window.removeEventListener(OPEN_MENTIONS, show); void client.removeChannel(channel); };
  }, [userId]);
  const single = batch.items.length === 1 ? batch.items[0] : null;
  return <>{hasItems && <aside ref={banner} role="status" aria-live="polite" className="fixed inset-x-3 top-24 z-[80] rounded-2xl border border-border bg-surface p-3 text-foreground shadow-xl sm:left-auto sm:right-4 sm:top-4 sm:w-96" data-testid="mention-notification" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={() => setFocused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <div className="flex items-start gap-3"><span aria-hidden className="text-2xl"><Avatar value={single?.avatar ?? "@"} /></span><div className="min-w-0 flex-1"><p className="text-sm font-medium">{mentionBatchLabel(batch.items)}</p>{single ? <Link href={`/chats/${single.conversation_id}#m-${single.message_id}`} onClick={dismiss} className="mt-1 inline-block text-sm font-semibold text-accent underline">View</Link> : <button type="button" className="mt-1 text-sm font-semibold text-accent underline" onClick={openPanel}>View</button>}</div><button type="button" aria-label="Dismiss mention notification" className="shrink-0 rounded-full px-2 py-1 text-muted hover:bg-accent-soft" onClick={dismiss}>✕</button></div>
  </aside>}{open && createPortal(<MentionsPanel state={state} onClose={() => setOpen(false)} />, document.body)}</>;
}
