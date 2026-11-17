"use client";
import { Avatar } from "@/components/Avatar";


import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { setMessageReaction } from "@/app/(app)/reaction-actions";
import { REACTIONS, ReactionDetails, reactionOverview, withReaction, type ReactionKey, type ReactionSummary } from "@/lib/chat/reactions";
import { ChatDialog } from "./ChatDialog";
import { LocalTime } from "@/components/LocalTime";

type Controls = { summary: ReactionSummary; pending: boolean; open: boolean; showPicker: (anchor: HTMLButtonElement) => void; showPeople: () => void };
const Context = createContext<Controls | null>(null);

/** One controller per shared message; the badge, details and picker share live counts. */
export function MessageReactions({ messageId, conversationId, userId, summary: source, available, children }: { messageId: string; conversationId: string; userId: string; summary?: ReactionSummary; available: boolean; children: ReactNode }) {
  const base = useMemo(() => source ?? { message_id: messageId, counts: {}, mine: null }, [source, messageId]);
  const [override, setOverride] = useState<{ base: ReactionSummary; value: ReactionSummary } | null>(null);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null); const [people, setPeople] = useState(false);
  const [error, setError] = useState(""); const [pending, start] = useTransition(); const saving = useRef(false);
  const summary = override?.base === base ? override.value : base;
  const closePicker = (focus = false) => { if (focus) anchor?.focus({ preventScroll: true }); setAnchor(null); };
  function choose(reaction: ReactionKey) {
    if (saving.current) return;
    const next = summary.mine === reaction ? null : reaction; saving.current = true;
    setError(""); setOverride({ base, value: withReaction(summary, next) }); closePicker(true);
    start(async () => {
      try {
        const result = await setMessageReaction(messageId, next);
        if (result.error || !result.summary) { setOverride(null); setError(result.error ?? "Couldn't save your reaction."); }
        else setOverride({ base, value: result.summary });
      } catch { setOverride(null); setError("Couldn't save your reaction. Check your connection and try again."); }
      finally { saving.current = false; }
    });
  }
  return <Context value={{ summary, pending, open: Boolean(anchor), showPicker: (button) => { setError(""); setAnchor(anchor === button ? null : button); }, showPeople: () => setPeople(true) }}>
    {children}
    {available && anchor && createPortal(<ReactionPicker anchor={anchor} selected={summary.mine} onChoose={choose} onClose={closePicker} />, document.body)}
    {available && people && createPortal(<ReactionPeople messageId={messageId} conversationId={conversationId} userId={userId} summary={summary} refreshToken={base} pending={pending} onRemove={() => { if (summary.mine) choose(summary.mine); }} onClose={() => setPeople(false)} />, document.body)}
    {error && createPortal(<ChatDialog label="Reaction not saved" onClose={() => setError("")}><div className="p-5"><p role="alert" className="text-sm">{error}</p><button type="button" className="btn-secondary mt-4" onClick={() => setError("")}>Close</button></div></ChatDialog>, document.body)}
  </Context>;
}

export function ReactionButton() {
  const controls = useContext(Context); if (!controls) return null;
  return <button type="button" aria-label="React" title="React" aria-haspopup="dialog" aria-expanded={controls.open} disabled={controls.pending} onClick={(event) => controls.showPicker(event.currentTarget)} className="rounded-full p-1 text-muted transition-colors hover:bg-accent-soft hover:text-accent focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40">
    <svg aria-hidden viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M8 14a4.5 4.5 0 0 0 8 0" /><path d="M8.5 9h.01M15.5 9h.01" strokeWidth="3" /></svg>
  </button>;
}

export function ReactionChips() {
  const controls = useContext(Context); if (!controls) return null;
  const { groups, total } = reactionOverview(controls.summary);
  if (!total) return null;
  return <button type="button" aria-haspopup="dialog" aria-label={`${total} ${total === 1 ? "person reacted" : "people reacted"}${controls.summary.mine ? ", including you" : ""}. View reactions`} onClick={controls.showPeople} data-testid="message-reactions" className={`mt-1 inline-flex min-h-7 items-center gap-1 rounded-full border px-2 py-0.5 text-xs tabular-nums transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-accent ${controls.summary.mine ? "border-accent bg-accent-soft text-foreground" : "border-border bg-surface text-muted"}`}>
    <span aria-hidden className="inline-flex items-center gap-0.5">{groups.slice(0, 3).map((r) => <span key={r.key} className="text-sm">{r.emoji}</span>)}</span><span className="ml-0.5">{total}</span>
  </button>;
}

function ReactionPicker({ anchor, selected, onChoose, onClose }: { anchor: HTMLButtonElement; selected: ReactionKey | null; onChoose: (key: ReactionKey) => void; onClose: (focus?: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null); const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current!; const rect = anchor.getBoundingClientRect(); const popup = el.getBoundingClientRect(); const view = window.visualViewport;
    const left = view?.offsetLeft ?? 0; const top = view?.offsetTop ?? 0; const width = view?.width ?? innerWidth; const height = view?.height ?? innerHeight;
    setPosition({ left: Math.max(left + 8, Math.min(rect.left - popup.width / 2, left + width - popup.width - 8)), top: Math.max(top + 8, Math.min(rect.top - popup.height - 6 >= top ? rect.top - popup.height - 6 : rect.bottom + 6, top + height - popup.height - 8)) });
  }, [anchor]);
  useLayoutEffect(() => {
    if (!position) return; const el = ref.current!;
    (el.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ?? el.querySelector<HTMLButtonElement>("button"))?.focus({ preventScroll: true });
  }, [position]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose(); };
    const scroll = (event: Event) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onClose(true); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape); window.addEventListener("scroll", scroll, true); window.addEventListener("resize", scroll); window.visualViewport?.addEventListener("resize", scroll);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); window.removeEventListener("scroll", scroll, true); window.removeEventListener("resize", scroll); window.visualViewport?.removeEventListener("resize", scroll); };
  }, [anchor, onClose]);
  return <div ref={ref} role="dialog" aria-label="Choose a reaction" className="fixed z-[60] flex max-w-[calc(100vw-1rem)] gap-0.5 rounded-full border border-border bg-surface p-1.5 shadow-xl" style={{ ...position, visibility: position ? "visible" : "hidden" }} onKeyDown={(event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>("button")]; const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowLeft" ? -1 : 1) + buttons.length) % buttons.length]?.focus({ preventScroll: true });
  }}>
    {REACTIONS.map((r) => <button type="button" key={r.key} aria-label={r.label} title={r.label} aria-pressed={r.key === selected} onClick={() => onChoose(r.key)} className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xl transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-accent ${r.key === selected ? "bg-accent-soft ring-1 ring-accent" : "hover:bg-accent-soft"}`}>{r.emoji}</button>)}
  </div>;
}

function ReactionPeople({ messageId, conversationId, userId, summary, refreshToken, pending, onRemove, onClose }: { messageId: string; conversationId: string; userId: string; summary: ReactionSummary; refreshToken: ReactionSummary; pending: boolean; onRemove: () => void; onClose: () => void }) {
  const [selected, setSelected] = useState<ReactionKey | null>(null);
  const { groups, total } = reactionOverview(summary);
  const filter = groups.some((r) => r.key === selected) ? selected : null;
  return <ChatDialog label="Message reactions" onClose={onClose} presentation="sheet">
    <div className="sticky top-0 z-10 bg-surface px-5 pb-3 pt-3">
      <div aria-hidden className="mx-auto mb-3 h-1 w-9 rounded-full bg-border sm:hidden" />
      <div className="mb-3 flex items-center justify-between gap-3"><h2 className="font-semibold">Message reactions</h2><button type="button" className="rounded-full px-2 py-1 text-muted hover:bg-accent-soft" aria-label="Close reactions" onClick={onClose}>✕</button></div>
      <div role="group" aria-label="Filter reactions" className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={filter === null} className={`rounded-full border px-3 py-1.5 text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-accent ${filter === null ? "border-accent bg-accent-soft" : "border-border hover:bg-accent-soft"}`} onClick={() => setSelected(null)}>All · {total}</button>
        {groups.map((r) => <button type="button" key={r.key} aria-label={`${r.label}: ${r.count}${summary.mine === r.key ? ", including you" : ""}`} aria-pressed={filter === r.key} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-accent ${filter === r.key ? "bg-accent-soft border-accent" : summary.mine === r.key ? "border-accent hover:bg-accent-soft" : "border-border hover:bg-accent-soft"}`} onClick={() => setSelected(r.key)}><span aria-hidden>{r.emoji}</span>{r.count}</button>)}
      </div>
    </div>
    <ReactionPeopleList key={filter ?? "all"} messageId={messageId} conversationId={conversationId} userId={userId} filter={filter} summary={summary} refreshToken={refreshToken} pending={pending} />
    {summary.mine && <div className="sticky bottom-0 border-t border-border bg-surface px-5 py-3"><button type="button" className="btn-secondary w-full" disabled={pending} onClick={onRemove}>{pending ? "Removing…" : "Remove my reaction"}</button></div>}
  </ChatDialog>;
}

/** Filtering happens before the server's 50-person page, including in large groups. */
function ReactionPeopleList({ messageId, conversationId, userId, filter, summary, refreshToken, pending }: { messageId: string; conversationId: string; userId: string; filter: ReactionKey | null; summary: ReactionSummary; refreshToken: ReactionSummary; pending: boolean }) {
  const [data, setData] = useState<ReactionDetails>({ items: [], hasMore: false }); const [busy, setBusy] = useState(true); const [error, setError] = useState(""); const [attempt, setAttempt] = useState(0);
  const moreAbort = useRef<AbortController | null>(null);
  const url = `/api/chats/${conversationId}/reactions?message=${messageId}${filter ? `&reaction=${filter}` : ""}`;
  useEffect(() => {
    if (pending) return; // Wait for our optimistic change to be committed before reading names.
    const abort = new AbortController();
    void fetch(url, { cache: "no-store", signal: abort.signal }).then(async (response) => {
      if (!response.ok) throw new Error(); const next = ReactionDetails.parse(await response.json());
      if (!abort.signal.aborted) { setData(next); setError(""); }
    }).catch(() => { if (!abort.signal.aborted) setError("Couldn't load reactions. Try again."); }).finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => { abort.abort(); moreAbort.current?.abort(); moreAbort.current = null; };
  }, [url, summary, refreshToken, pending, attempt]);
  async function more() {
    if (moreAbort.current || busy || pending) return;
    const abort = new AbortController(); moreAbort.current = abort; setBusy(true); setError("");
    try {
      const response = await fetch(`${url}&offset=${data.items.length}`, { cache: "no-store", signal: abort.signal }); if (!response.ok) throw new Error();
      const next = ReactionDetails.parse(await response.json());
      if (!abort.signal.aborted) setData((previous) => ({ items: [...new Map([...previous.items, ...next.items].map((item) => [item.user_id, item])).values()], hasMore: next.hasMore }));
    } catch { if (!abort.signal.aborted) setError("Couldn't load more reactions. Try again."); }
    finally { if (!abort.signal.aborted) { moreAbort.current = null; setBusy(false); } }
  }
  return <div className="px-5 pb-4" aria-busy={busy || pending}>
    <ul aria-label="People who reacted" className="divide-y divide-border">{data.items.map((item) => <li key={item.user_id} data-testid="reaction-person" className={`flex items-center gap-3 py-3 ${item.user_id === userId ? "rounded-xl bg-accent-soft/50" : ""}`}>
      <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-2xl"><Avatar value={item.avatar ?? "👤"} /></span>
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.name ?? "Former member"}{item.user_id === userId && <span className="ml-1 text-xs font-normal text-muted">(you)</span>}</p>{item.handle && <p className="truncate text-xs text-muted">@{item.handle}</p>}<p className="mt-0.5 text-[11px] text-muted"><LocalTime iso={item.reacted_at} full /></p></div>
      <span className="shrink-0 pl-2 text-2xl" aria-label={REACTIONS.find((r) => r.key === item.reaction)?.label}>{REACTIONS.find((r) => r.key === item.reaction)?.emoji}</span>
    </li>)}</ul>
    {busy && <p role="status" className="py-2 text-sm text-muted">Loading reactions…</p>}
    {!busy && !data.items.length && !error && <p className="py-3 text-sm text-muted">No reactions yet.</p>}
    {error && <div className="space-y-2"><p role="alert" className="text-sm text-danger">{error}</p><button type="button" className="btn-secondary" onClick={() => { setError(""); setBusy(true); setAttempt((n) => n + 1); }}>Retry</button></div>}
    {data.hasMore && <button type="button" className="btn-secondary mt-3" disabled={busy || pending} onClick={() => void more()}>Load more</button>}
  </div>;
}
