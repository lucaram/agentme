"use client";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { ChatDialog } from "@/components/chat/ChatDialog";
import { LocalTime } from "@/components/LocalTime";
import { useCurrentNotifications } from "@/components/notifications/NotificationProvider";
import { READ_EVENT } from "@/components/ChatsBadge";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { TOPIC_GROUPS, TOPIC_TITLES, TopicPage, topicLabel, topicPageUrl, type Topic, type TopicGroup, type TopicSeed, type TopicView } from "@/lib/agents/topic-types";

type Bucket = { items: Topic[]; hasMore: boolean; asOf?: string; pages: number; busy: boolean; error: string; retry?: "refresh" | "more" };
type Position = { top: number; id?: string; offset?: number };
type Navigation = {
  conversationId: string; attention: number; buckets: Record<TopicView, Bucket>; counts: TopicPage["counts"]; group: TopicGroup; query: string;
  choose: (group: TopicGroup) => void; search: (query: string) => void; more: (view: TopicView) => void; refresh: () => void;
  getPosition: (view: TopicView) => Position | undefined; canRestore: (view: TopicView) => boolean; remember: (view: TopicView, position: Position) => void; openTopics: () => void;
};
const Context = createContext<Navigation | null>(null);
const empty = (): Bucket => ({ items: [], hasMore: false, pages: 0, busy: false, error: "" });
function initialBuckets(seed: TopicSeed): Record<TopicView, Bucket> {
  const from = (page: TopicPage | null) => page ? { ...page, pages: 1, busy: false, error: "" } : empty();
  return { needs: from(seed.needs), progress: from(seed.progress), recent: from(seed.recent), older: empty(), search: empty() };
}
function useNavigation() { const value = useContext(Context); if (!value) throw new Error("Topics must be inside My Agent"); return value; }

/** Persists across topic changes because it lives in the conversation layout. */
export function TopicWorkspace({ conversationId, userId, seed, children }: { conversationId: string; userId: string; seed: TopicSeed; children: ReactNode }) {
  const notifications = useCurrentNotifications(); const attention = notifications?.attention ?? 0;
  const notificationKey = `${attention}:${notifications?.unread.find((row) => row.conversation_id === conversationId)?.unread ?? 0}`;
  const [buckets, setBuckets] = useState(() => initialBuckets(seed)); const latest = useRef(buckets);
  const [counts, setCounts] = useState(seed.recent?.counts ?? seed.progress?.counts ?? seed.needs?.counts ?? { needs: 0, progress: 0, recent: 0, older: 0 });
  const [group, setGroup] = useState<TopicGroup>("recent"); const groupRef = useRef(group); const [query, setQuery] = useState(""); const queryRef = useRef("");
  const [open, setOpen] = useState(false); const positions = useRef<Partial<Record<TopicView, Position>>>({}); const root = useRef<HTMLDivElement>(null);
  const getPosition = useCallback((view: TopicView) => positions.current[view], []);
  const remember = useCallback((view: TopicView, position: Position) => { positions.current[view] = position; }, []);
  const control = useRef<{ more: (view: TopicView) => void; refresh: () => void; search: (q: string) => void } | null>(null);
  const requestedPages = useRef<Partial<Record<TopicView, number>>>({});
  const canRestore = useCallback((view: TopicView) => !latest.current[view].busy && latest.current[view].pages >= (requestedPages.current[view] ?? 1), []);
  const booted = useRef(false); const key = `agentme:topics:${userId}:${conversationId}`; const seedKey = JSON.stringify(seed);
  useLayoutEffect(() => {
    const size = () => { root.current?.style.setProperty("--topics-top", `${Math.max(16, (document.querySelector("header")?.getBoundingClientRect().bottom ?? 100) + 16)}px`); };
    size(); window.addEventListener("resize", size); window.visualViewport?.addEventListener("resize", size);
    return () => { window.removeEventListener("resize", size); window.visualViewport?.removeEventListener("resize", size); };
  }, []);
  useEffect(() => {
    const savedPositions = positions.current;
    const pending = new Map<TopicView, AbortController>(); let live = true; let searchTimer: ReturnType<typeof setTimeout>;
    const commit = (view: TopicView, bucket: Bucket) => { if (!live) return; const next = { ...latest.current, [view]: bucket }; latest.current = next; setBuckets(next); };
    async function fetchPage(view: TopicView, q: string, asOf: string, signal: AbortSignal, last?: Topic) {
      const response = await fetch(topicPageUrl(conversationId, view, q, asOf, last), { cache: "no-store", signal });
      if (!response.ok) throw new Error("Couldn't load topics. Try again."); return TopicPage.parse(await response.json());
    }
    async function load(view: TopicView, refresh = false, pageCount?: number) {
      if (!live) return;
      if (pending.has(view)) { if (!refresh) return; pending.get(view)!.abort(); }
      const abort = new AbortController(); pending.set(view, abort); const old = latest.current[view];
      const q = view === "search" ? queryRef.current : ""; const asOf = refresh || !old.asOf ? new Date().toISOString() : old.asOf;
      const requested = refresh ? Math.max(1, pageCount ?? Math.max(old.pages, requestedPages.current[view] ?? 0)) : 1;
      requestedPages.current[view] = refresh ? requested : old.pages + 1;
      commit(view, { ...old, busy: true, error: "" });
      try {
        let page = await fetchPage(view, q, asOf, abort.signal, refresh ? undefined : old.items.at(-1));
        const items = refresh ? [...page.items] : [...old.items, ...page.items];
        let loaded = 1;
        while (loaded < requested && page.hasMore) { page = await fetchPage(view, q, asOf, abort.signal, items.at(-1)); items.push(...page.items); loaded++; }
        if (!live || abort.signal.aborted) return;
        requestedPages.current[view] = refresh ? loaded : old.pages + 1;
        setCounts(page.counts); commit(view, { items: [...new Map(items.map((item) => [item.id, item])).values()], hasMore: page.hasMore, asOf: page.asOf, pages: refresh ? loaded : old.pages + 1, busy: false, error: "" });
      } catch (cause) { if (live && !abort.signal.aborted) commit(view, { ...latest.current[view], busy: false, retry: refresh ? "refresh" : "more", error: cause instanceof Error ? cause.message : "Couldn't load topics." }); }
      finally { if (pending.get(view) === abort) pending.delete(view); }
    }
    const refresh = () => {
      for (const view of TOPIC_GROUPS) if (view !== "older" || latest.current.older.pages || requestedPages.current.older || groupRef.current === "older") void load(view, true);
      if (queryRef.current) void load("search", true);
    };
    control.current = { more: (view) => { void load(view, latest.current[view].retry === "refresh"); }, refresh, search: (q) => { clearTimeout(searchTimer); pending.get("search")?.abort(); pending.delete("search"); requestedPages.current.search = 1; commit("search", { ...empty(), busy: Boolean(q) }); searchTimer = setTimeout(() => { if (q) void load("search", true); }, 300); } };
    void (async () => {
      if (!booted.current) {
        booted.current = true;
        try {
          const saved = JSON.parse(sessionStorage.getItem(key) ?? "null");
          if (saved && TOPIC_GROUPS.includes(saved.group)) { groupRef.current = saved.group; setGroup(saved.group); }
          for (const view of TOPIC_GROUPS) {
            const pages = Math.min(100, Math.max(1, Number(saved?.pages?.[view]) || 1));
            const position = saved?.positions?.[view]; if (position && Number.isFinite(position.top) && position.top >= 0 && (!position.id || /^[0-9a-f-]{36}$/i.test(position.id))) positions.current[view] = position;
            if (pages > 1 || (view === "older" && groupRef.current === view)) void load(view, true, pages);
          }
        } catch { /* Storage can be disabled. Navigation still works. */ }
        for (const view of ["needs", "progress", "recent"] as const) if (!latest.current[view].pages) void load(view, true);
      } else refresh();
    })();
    const persist = () => { try { sessionStorage.setItem(key, JSON.stringify({ group: groupRef.current, positions: savedPositions, pages: Object.fromEntries(TOPIC_GROUPS.map((v) => [v, Math.max(latest.current[v].pages, requestedPages.current[v] ?? 0)])) })); } catch { /* Device-local convenience only. */ } };
    const onRead = () => refresh(); const focus = () => { if (document.visibilityState === "visible") refresh(); }; const visibility = () => { if (document.visibilityState === "hidden") persist(); else focus(); };
    window.addEventListener(READ_EVENT, onRead); window.addEventListener("focus", focus); window.addEventListener("pagehide", persist); document.addEventListener("visibilitychange", visibility);
    const timer = setInterval(focus, 30000);
    return () => {
      live = false; for (const abort of pending.values()) abort.abort(); clearTimeout(searchTimer); clearInterval(timer); control.current = null;
      window.removeEventListener(READ_EVENT, onRead); window.removeEventListener("focus", focus); window.removeEventListener("pagehide", persist); document.removeEventListener("visibilitychange", visibility); persist();
    };
  }, [conversationId, key, seedKey]);
  useEffect(() => { control.current?.refresh(); }, [notificationKey]);
  const choose = (value: TopicGroup) => { groupRef.current = value; setGroup(value); queryRef.current = ""; setQuery(""); control.current?.search(""); if (!latest.current[value].pages) control.current?.more(value); };
  const search = (value: string) => { setQuery(value); queryRef.current = value.trim(); control.current?.search(value.trim()); };
  const openTopics = () => { if (matchMedia("(min-width: 1024px)").matches) requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('aside button[aria-pressed="true"]')?.focus()); else setOpen(true); };
  const navigation: Navigation = { conversationId, attention, buckets, counts, group, query, choose, search, more: (v) => control.current?.more(v), refresh: () => control.current?.refresh(), getPosition, canRestore, remember, openTopics };
  return <Context.Provider value={navigation}><RealtimeRefresh channel={`topic-titles-${userId}-${conversationId}`} tables={["agent_threads"]} /><div ref={root} data-agent-workspace className="grid min-w-0 flex-1 gap-5 lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start">
    <aside className="sticky top-[var(--topics-top,8rem)] hidden h-[calc(100dvh-var(--topics-top,8rem)-1rem)] min-h-72 min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface lg:flex" aria-label="My Agent topics"><TopicNavigator /></aside>
    <main className="flex min-w-0 flex-1 flex-col lg:min-h-[calc(100dvh-var(--topics-top,8rem)-1rem)]"><div className="mb-3 lg:hidden"><button type="button" className="btn-secondary" aria-haspopup="dialog" onClick={() => setOpen(true)}>☰ Topics</button></div>{children}</main>
  </div>{open && createPortal(<ChatDialog label="My Agent topics" presentation="sheet" onClose={() => setOpen(false)}><div className="flex h-[75dvh] flex-col"><div className="flex items-center justify-between border-b border-border px-4 py-3"><h2 className="font-semibold">Topics</h2><button type="button" aria-label="Close topics" className="rounded-full px-2 py-1 text-muted" onClick={() => setOpen(false)}>✕</button></div><TopicNavigator onNavigate={() => setOpen(false)} /></div></ChatDialog>, document.body)}</Context.Provider>;
}

function TopicNavigator({ onNavigate }: { onNavigate?: () => void }) {
  const nav = useNavigation(); const selected = useSearchParams().get("t"); const scroll = useRef<HTMLDivElement>(null); const interacted = useRef(false);
  const getPosition = nav.getPosition;
  const canRestore = nav.canRestore;
  const view: TopicView = nav.query.trim() ? "search" : nav.group; const bucket = nav.buckets[view];
  useLayoutEffect(() => {
    if (!canRestore(view)) return; // Strict Mode can replay layout effects before the restored page state commits.
    const el = scroll.current; const position = getPosition(view); if (!el?.clientHeight || !position) { if (el) el.scrollTop = 0; return; }
    const anchor = position.id ? el.querySelector<HTMLElement>(`[data-topic-id="${position.id}"]`) : null;
    if (position.id && !anchor && bucket.busy) return;
    if (anchor) el.scrollTop += anchor.getBoundingClientRect().top - el.getBoundingClientRect().top - (position.offset ?? 0); else el.scrollTop = position.top;
  }, [view, bucket.items, bucket.busy, getPosition, canRestore]);
  function capture() {
    if (!canRestore(view) && !interacted.current) return;
    const el = scroll.current; if (!el?.clientHeight) return;
    const top = el.getBoundingClientRect().top; const row = [...el.querySelectorAll<HTMLElement>("[data-topic-id]")].find((item) => item.getBoundingClientRect().bottom > top + 1);
    nav.remember(view, { top: el.scrollTop, id: row?.dataset.topicId, offset: row ? row.getBoundingClientRect().top - top : undefined });
    if (interacted.current && el.scrollHeight - el.clientHeight - el.scrollTop < 100 && bucket.hasMore && !bucket.busy && !bucket.error) { interacted.current = false; nav.more(view); }
  }
  return <><div className="space-y-3 border-b border-border p-3"><div className="flex items-center justify-between gap-2"><Link href={`/chats/${nav.conversationId}`} className="text-sm font-semibold hover:text-accent" onClick={onNavigate}>My Agent</Link><Link href={`/chats/${nav.conversationId}?t=new`} className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white dark:text-black" data-testid="topic-new-request" onClick={onNavigate}>＋ New request</Link></div>
    <input type="search" aria-label="Search topics" placeholder="Search topics" maxLength={80} value={nav.query} onChange={(event) => nav.search(event.target.value)} className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm" />
    <div className="grid grid-cols-2 gap-1" aria-label="Topic views">{TOPIC_GROUPS.map((v) => <button type="button" key={v} aria-pressed={!nav.query.trim() && nav.group === v} className={`flex items-center justify-between gap-1 rounded-lg px-2 py-1.5 text-xs ${!nav.query.trim() && nav.group === v ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-accent-soft"}`} onClick={() => nav.choose(v)}>{TOPIC_TITLES[v]}<span className="tabular-nums">{nav.counts[v] + (v === "needs" ? nav.attention : 0)}</span></button>)}</div>
  </div><div ref={scroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 [overflow-anchor:none]" data-testid="topic-scroll" tabIndex={0} aria-label="Topic list" onScroll={capture} onWheel={() => { interacted.current = true; }} onTouchMove={() => { interacted.current = true; }} onKeyDown={(event) => { if (["ArrowDown", "PageDown", "End", " "].includes(event.key)) interacted.current = true; }}>
    {view === "needs" && nav.attention > 0 && <Link href={`/chats/${nav.conversationId}#needs-your-answer`} onClick={onNavigate} className="mb-2 block rounded-xl border border-accent bg-accent-soft px-3 py-3 text-sm font-semibold text-accent" data-testid="topic-attention">{nav.attention} {nav.attention === 1 ? "request needs" : "requests need"} your attention →</Link>}
    <ul className="space-y-1" aria-label={view === "search" ? "Search results" : TOPIC_TITLES[view]}>{bucket.items.map((topic) => <li key={topic.id} data-topic-id={topic.id}><TopicLink topic={topic} conversationId={nav.conversationId} selected={selected === topic.id} onNavigate={onNavigate} /></li>)}</ul>
    {bucket.busy && <p className="p-3 text-xs text-muted" role="status">Loading topics…</p>}
    {!bucket.busy && !bucket.error && !bucket.items.length && !(view === "needs" && nav.attention > 0) && <p className="p-3 text-sm text-muted">{view === "search" ? "No matching topics." : `No topics ${view === "older" ? "in history" : "here"} yet.`}</p>}
    {bucket.error && <p role="alert" className="p-2 text-xs text-danger">{bucket.error}</p>}
    {(bucket.hasMore || bucket.error) && <button type="button" disabled={bucket.busy} className="mt-2 w-full rounded-xl border border-border px-3 py-2 text-xs font-medium hover:bg-accent-soft" onClick={() => nav.more(view)}>{bucket.error ? "Try again" : "Load more"}</button>}
  </div></>;
}

function TopicLink({ topic, conversationId, selected = false, onNavigate, compact = false }: { topic: Topic; conversationId: string; selected?: boolean; onNavigate?: () => void; compact?: boolean }) {
  const label = topicLabel(topic);
  return <Link href={`/chats/${conversationId}?t=${topic.id}`} prefetch={false} aria-current={selected ? "page" : undefined} className={`block min-w-0 rounded-xl px-3 py-2.5 ${selected ? "bg-accent-soft ring-1 ring-inset ring-accent" : "hover:bg-accent-soft"}`} data-testid="agent-thread" onClick={onNavigate}>
    <span className="flex items-center gap-2"><span className={`min-w-0 flex-1 truncate text-sm ${topic.unread ? "font-semibold" : "font-medium"}`}>{topic.kind === "updates" ? "📬 " : ""}{topic.title}</span>{topic.unread > 0 && <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white dark:text-black" data-testid="thread-badge" aria-label={`${topic.unread} new`}>{topic.unread > 99 ? "99+" : topic.unread}</span>}</span>
    {label && <span className="mt-0.5 block truncate text-xs text-accent">{label}</span>}{!compact && <span className="mt-0.5 block truncate text-xs text-muted">{topic.preview}</span>}
    <span className="mt-1 block text-[10px] text-muted"><LocalTime iso={topic.last_activity_at} /></span>
  </Link>;
}

/** A compact overview; the full lists and history stay in topic navigation. */
export function TopicOverview() {
  const nav = useNavigation();
  return <div className="space-y-4">{(["needs", "progress"] as const).map((group) => {
    const bucket = nav.buckets[group]; const count = nav.counts[group]; if (!count && !bucket.error) return null;
    return <section key={group} aria-label={group === "needs" ? "Requests needing you" : "Work in progress"} className="overflow-hidden rounded-2xl border border-border bg-surface"><div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">{group === "needs" ? "Needs your attention" : "In progress"}<span className="ml-2 text-xs text-muted">{count}</span></h2><button type="button" className="text-xs font-medium text-accent hover:underline" onClick={() => { nav.choose(group); nav.openTopics(); }}>View all</button></div><ul className="divide-y divide-border px-1">{bucket.items.slice(0, 3).map((topic) => <li key={topic.id}><TopicLink topic={topic} conversationId={nav.conversationId} compact /></li>)}</ul>{bucket.error && <button type="button" className="p-3 text-sm text-accent" onClick={nav.refresh}>Couldn&apos;t load requests. Try again.</button>}</section>;
  })}{!nav.attention && !Object.values(nav.counts).some(Boolean) && <p className="card text-sm text-muted">Start a new request below. Your conversations will appear in Topics.</p>}
    {!nav.attention && Object.values(nav.counts).some(Boolean) && !nav.counts.needs && !nav.counts.progress && <div className="rounded-2xl border border-border bg-surface p-5"><h2 className="font-semibold">What would you like to do?</h2><p className="mt-1 text-sm text-muted">Start a request below, or continue a conversation from Topics.</p></div>}
  </div>;
}
