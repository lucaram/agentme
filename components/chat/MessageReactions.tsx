"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { setMessageReaction } from "@/app/(app)/reaction-actions";
import { REACTIONS, ReactionDetails, withReaction, type ReactionKey, type ReactionSummary } from "@/lib/chat/reactions";
import { ChatDialog } from "./ChatDialog";
import { LocalTime } from "@/components/LocalTime";

type Controls = { summary: ReactionSummary; pending: boolean; open: boolean; showPicker: (anchor: HTMLButtonElement) => void; showPeople: () => void };
const Context = createContext<Controls | null>(null);

/** One controller per shared message; optimistic chips stay in sync with its picker. */
export function MessageReactions({ messageId, conversationId, summary: source, available, children }: { messageId: string; conversationId: string; summary?: ReactionSummary; available: boolean; children: ReactNode }) {
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
    {available && people && createPortal(<ReactionPeople key={JSON.stringify(base)} messageId={messageId} conversationId={conversationId} onClose={() => setPeople(false)} />, document.body)}
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
  const reactions = REACTIONS.filter((r) => (controls.summary.counts[r.key] ?? 0) > 0);
  if (!reactions.length) return null;
  return <div className="mt-1 flex max-w-[85%] flex-wrap gap-1" role="group" aria-label="Message reactions" data-testid="message-reactions">
    {reactions.slice(0, 3).map((r) => <button type="button" key={r.key} aria-label={`${r.label}: ${controls.summary.counts[r.key]}${controls.summary.mine === r.key ? ', including you' : ''}. View reactions`} onClick={controls.showPeople} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs tabular-nums transition-colors hover:border-accent ${controls.summary.mine === r.key ? "border-accent bg-accent-soft text-foreground" : "border-border bg-surface text-muted"}`}><span aria-hidden>{r.emoji}</span>{controls.summary.counts[r.key]}</button>)}
    {reactions.length > 3 && <button type="button" className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-muted hover:border-accent" aria-label="View all reactions" onClick={controls.showPeople}>+{reactions.length - 3}</button>}
  </div>;
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

function ReactionPeople({ messageId, conversationId, onClose }: { messageId: string; conversationId: string; onClose: () => void }) {
  const [data, setData] = useState<ReactionDetails>({ items: [], hasMore: false }); const [busy, setBusy] = useState(true); const [error, setError] = useState("");
  const moreRef = useRef(false);
  useEffect(() => {
    const abort = new AbortController();
    void fetch(`/api/chats/${conversationId}/reactions?message=${messageId}`, { cache: "no-store", signal: abort.signal }).then(async (response) => { if (!response.ok) throw new Error(); setData(ReactionDetails.parse(await response.json())); }).catch(() => { if (!abort.signal.aborted) setError("Couldn't load reactions. Close and try again."); }).finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [messageId, conversationId]);
  async function more() {
    if (moreRef.current) return; moreRef.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/chats/${conversationId}/reactions?message=${messageId}&offset=${data.items.length}`, { cache: "no-store" }); if (!response.ok) throw new Error();
      const next = ReactionDetails.parse(await response.json()); setData((previous) => ({ items: [...new Map([...previous.items, ...next.items].map((item) => [item.user_id, item])).values()], hasMore: next.hasMore }));
    } catch { setError("Couldn't load more reactions. Try again."); } finally { moreRef.current = false; setBusy(false); }
  }
  return <ChatDialog label="Message reactions" onClose={onClose}><div className="p-5">
    <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Message reactions</h2><button type="button" className="rounded-full px-2 py-1 text-muted hover:bg-accent-soft" aria-label="Close reactions" onClick={onClose}>✕</button></div>
    <ul className="divide-y divide-border">{data.items.map((item) => <li key={item.user_id} className="flex items-center gap-3 py-3"><span aria-hidden className="text-xl">{REACTIONS.find((r) => r.key === item.reaction)?.emoji}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.avatar} {item.name ?? "Former member"}</p>{item.handle && <p className="truncate text-xs text-muted">@{item.handle}</p>}</div><span className="shrink-0 text-[11px] tabular-nums text-muted"><LocalTime iso={item.reacted_at} /></span></li>)}</ul>
    {busy && <p role="status" className="py-2 text-sm text-muted">Loading reactions…</p>}
    {!busy && !data.items.length && !error && <p className="text-sm text-muted">No reactions yet.</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {data.hasMore && <button type="button" className="btn-secondary mt-3" disabled={busy} onClick={() => void more()}>Load more</button>}
  </div></ChatDialog>;
}
