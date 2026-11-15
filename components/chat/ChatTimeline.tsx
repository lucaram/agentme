"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MessageList } from "@/app/(app)/chats/[id]/MessageList";
import { MarkRead } from "@/components/MarkRead";
import { READ_EVENT } from "@/components/ChatsBadge";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { UnavailableReplies } from "./UnavailableReplies";
import type { HistoryBundle, HistoryRequest } from "@/lib/chat/history-types";
import { mergeHistory } from "@/lib/chat/history-window";
import { compareMessages, MESSAGES_PER_PAGE } from "@/lib/social/paging";
import { CHAT_JUMP, CHAT_SENT, chatScope, consumeChatSent, readChatPosition, saveChatPosition, type ChatPosition } from "@/lib/client/chat-position";

type Layout = { kind: "bottom" } | { kind: "anchor"; position: ChatPosition } | { kind: "message"; id: string; flash?: boolean };
type Control = { layout: () => void; refresh: (seed: HistoryBundle) => void; older: () => void; newer: () => void; latest: () => void };

/** One bounded message window; older/newer chunks can be revisited indefinitely. */
export function ChatTimeline({ initial, leading, children }: { initial: HistoryBundle; leading?: ReactNode; children: ReactNode }) {
  const start = useRef(initial); const control = useRef<Control | null>(null);
  const frame = useRef<HTMLDivElement>(null); const viewport = useRef<HTMLDivElement>(null); const content = useRef<HTMLOListElement>(null); const footer = useRef<HTMLDivElement>(null);
  const [bundle, setBundle] = useState(initial); const [ready, setReady] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [down, setDown] = useState({ show: false, count: 0 });
  useLayoutEffect(() => { start.current = bundle; control.current?.layout(); }, [bundle]);
  useEffect(() => {
    const root = frame.current!; const scroll = viewport.current!; const list = content.current!; const composer = footer.current!;
    scroll.dataset.chatReady = "false";
    const seed = start.current; const scope = chatScope(seed.conversationId, seed.threadId); const storageKey = `${seed.userId}:${scope}`;
    const enabled = seed.kind !== "my_agent" || Boolean(seed.threadId);
    const abort = new AbortController(); let stopped = false; let booted = false; let fetching = false; let queued: HistoryBundle | null = null;
    let intent: (() => Promise<void>) | null = null; let drainFrame = 0;
    let current = seed; let pendingLayout: Layout | null = null; let anchored: ChatPosition | null = null; let follow = true; let interacted = false; let animation = 0; let saveTimer: ReturnType<typeof setTimeout> | undefined;
    const seen = new Set<string>();
    const row = (id: string) => scroll.querySelector<HTMLElement>(`[data-timeline-message="${id}"]`);
    const distance = () => Math.max(0, scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop);
    function capture(): ChatPosition | null {
      const top = scroll.getBoundingClientRect().top;
      const element = [...list.querySelectorAll<HTMLElement>("[data-timeline-message]")].find((el) => el.getBoundingClientRect().bottom > top + 1);
      return element ? { id: element.dataset.timelineMessage!, offset: element.getBoundingClientRect().top - top, bottom: distance() < 80 && !current.hasAfter } : null;
    }
    function restore(position: ChatPosition) { const element = row(position.id); if (element) scroll.scrollTop += element.getBoundingClientRect().top - scroll.getBoundingClientRect().top - position.offset; }
    function stats() {
      if (!booted || stopped || pendingLayout) return;
      follow = distance() < 80 && !current.hasAfter;
      anchored = capture(); const bottom = scroll.getBoundingClientRect().bottom;
      const count = current.unreadAfter + current.unreadIds.filter((id) => !seen.has(id) && (row(id)?.getBoundingClientRect().top ?? -Infinity) >= bottom - 4).length;
      const show = distance() > 80 || current.hasAfter;
      setDown((old) => old.show === show && old.count === count ? old : { show, count });
    }
    function save() { if (anchored) saveChatPosition(storageKey, anchored); }
    function dimensions() {
      const height = window.visualViewport?.height ?? window.innerHeight;
      root.style.height = `${Math.max(180, height - root.getBoundingClientRect().top - 16)}px`;
    }
    function layout() {
      if (stopped) return; dimensions();
      if (pendingLayout) {
        const target = pendingLayout; pendingLayout = null;
        if (target.kind === "bottom") scroll.scrollTop = scroll.scrollHeight;
        else if (target.kind === "anchor") restore(target.position);
        else {
          const element = row(target.id);
          if (element) {
            scroll.scrollTop += element.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 8;
            if (target.flash) { element.classList.add("reply-flash"); setTimeout(() => element.classList.remove("reply-flash"), 1600); }
          }
        }
      }
      stats();
    }
    function commit(next: HistoryBundle, target: Layout | null) { current = next; pendingLayout = target; if (target) follow = target.kind === "bottom"; setBundle(next); }
    async function fetchPage(request: HistoryRequest) {
      const query = new URLSearchParams({ mode: request.mode });
      if (seed.threadId) query.set("thread", seed.threadId); if (request.anchor) query.set("anchor", request.anchor);
      request.ids?.forEach((id) => query.append("item", id));
      const response = await fetch(`/api/chats/${seed.conversationId}/history?${query}`, { cache: "no-store", signal: abort.signal });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 404 ? "This conversation is unavailable. Refresh to check access." : "Couldn't load messages. Try again.");
      return await response.json() as HistoryBundle;
    }
    function drain() {
      cancelAnimationFrame(drainFrame);
      drainFrame = requestAnimationFrame(() => {
        if (stopped || fetching || !booted) return;
        if (pendingLayout) { drain(); return; }
        if (intent) { const next = intent; intent = null; void next(); }
        else if (interacted && scroll.scrollTop < 120 && current.hasBefore) void more("before");
        else if (interacted && distance() < 120 && current.hasAfter) void more("after");
        else if (queued) { const next = queued; queued = null; void refresh(next); }
      });
    }
    async function run(work: () => Promise<void>) {
      if (stopped || fetching || !enabled) return;
      fetching = true; setBusy(true); setError("");
      try { await work(); } catch (cause) { if (!stopped) setError(cause instanceof Error ? cause.message : "Couldn't load messages. Try again."); }
      finally {
        fetching = false; if (!stopped) { setBusy(false); drain(); }
      }
    }
    async function refresh(nextSeed: HistoryBundle) {
      if (!booted || fetching) { queued = nextSeed; return; }
      await run(async () => {
        const pinned = distance() < 80 && !current.hasAfter;
        if (pinned) {
          const next = await fetchPage({ mode: "latest" });
          if (!stopped) {
            // A user may start reading history while this request is in flight.
            if (distance() < 80 && !current.hasAfter) commit(next, { kind: "bottom" });
            else queued = nextSeed;
          }
        } else {
          const first = current.messages[0]; const last = current.messages.at(-1);
          const extra = nextSeed.messages.filter((m) => first && last && compareMessages(m, first) >= 0 && compareMessages(m, last) <= 0).map((m) => m.id);
          const ids = [...new Set([...current.messages.map((m) => m.id), ...extra])];
          const requests: Promise<HistoryBundle>[] = [];
          for (let i = 0; i < ids.length; i += MESSAGES_PER_PAGE) requests.push(fetchPage({ mode: "refresh", ids: ids.slice(i, i + MESSAGES_PER_PAGE) }));
          if (!requests.length) requests.push(fetchPage({ mode: "latest" }));
          const next = await Promise.all(requests);
          if (!stopped) {
            const position = capture();
            commit(mergeHistory(current, next, "refresh"), position ? { kind: "anchor", position } : null);
          }
        }
      });
    }
    async function more(side: "before" | "after") {
      if (!booted || fetching || !(side === "before" ? current.hasBefore : current.hasAfter)) return;
      interacted = false;
      await run(async () => {
        const edge = side === "before" ? current.messages[0] : current.messages.at(-1); if (!edge) return;
        const next = await fetchPage({ mode: side, anchor: edge.id });
        if (!stopped) {
          const position = capture(); const merged = mergeHistory(current, [next], side);
          // Do not evict the message the user moved to while loading this chunk.
          if (!position || merged.messages.some((message) => message.id === position.id)) commit(merged, position ? { kind: "anchor", position } : null);
        }
      });
    }
    async function latest(force = false) {
      if (!booted) return;
      if (fetching) { intent = () => latest(force); return; }
      // Instant relocation prevents skipped messages becoming visible during a long animated scroll.
      if (!force && !current.hasAfter) { scroll.scrollTop = scroll.scrollHeight; stats(); save(); return; }
      await run(async () => { const next = await fetchPage({ mode: "latest" }); if (!stopped) commit(next, { kind: "bottom" }); });
    }
    async function jump(id: string, flash = true) {
      if (!booted) return;
      if (fetching) { intent = () => jump(id, flash); return; }
      if (row(id)) { pendingLayout = { kind: "message", id, flash }; layout(); return; }
      await run(async () => { const next = await fetchPage({ mode: "around", anchor: id }); if (!stopped) commit(next, { kind: "message", id, flash }); });
    }
    function scrolled() {
      cancelAnimationFrame(animation);
      animation = requestAnimationFrame(() => {
        if (pendingLayout) return;
        stats(); clearTimeout(saveTimer); saveTimer = setTimeout(save, 150);
        if (interacted && booted && !fetching) {
          if (scroll.scrollTop < 120 && current.hasBefore) void more("before");
          else if (distance() < 120 && current.hasAfter) void more("after");
        }
      });
    }
    const interaction = (event: Event) => {
      if (event.type === "pointerdown" && event.target !== scroll) return;
      if (event instanceof KeyboardEvent && !["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) return;
      interacted = true; scrolled();
    };
    const read = (event: Event) => { const ids = (event as CustomEvent<{ ids?: string[] }>).detail?.ids ?? []; ids.forEach((id) => seen.add(id)); stats(); };
    const jumpEvent = (event: Event) => { const id = (event as CustomEvent<{ id?: string }>).detail?.id; if (id && /^[0-9a-f-]{36}$/i.test(id)) void jump(id); };
    const hash = () => { const id = window.location.hash.match(/^#m-([0-9a-f-]{36})$/i)?.[1]; if (id) void jump(id); };
    const sent = (event: Event) => {
      if ((event as CustomEvent<{ scope: string }>).detail.scope !== scope) return;
      consumeChatSent(scope); intent = () => latest(true); drain();
    };
    control.current = { layout, refresh: (next) => { void refresh(next); }, older: () => { void more("before"); }, newer: () => { void more("after"); }, latest: () => { void latest(); } };
    const resized = new ResizeObserver(() => {
      dimensions(); composer.scrollTop = composer.scrollHeight;
      if (booted) { if (follow) scroll.scrollTop = scroll.scrollHeight; else if (anchored) restore(anchored); stats(); }
    });
    resized.observe(root); resized.observe(list); resized.observe(composer); if (list.parentElement) resized.observe(list.parentElement);
    const header = document.querySelector("header"); if (header) resized.observe(header);
    scroll.addEventListener("scroll", scrolled); scroll.addEventListener("wheel", interaction, { passive: true }); scroll.addEventListener("touchmove", interaction, { passive: true }); scroll.addEventListener("pointerdown", interaction); scroll.addEventListener("keydown", interaction);
    window.addEventListener(READ_EVENT, read); window.addEventListener(CHAT_JUMP, jumpEvent); window.addEventListener(CHAT_SENT, sent); window.addEventListener("hashchange", hash); window.addEventListener("pagehide", save); window.addEventListener("blur", save); window.addEventListener("resize", dimensions);
    window.visualViewport?.addEventListener("resize", dimensions); window.visualViewport?.addEventListener("scroll", dimensions);
    void (async () => {
      window.scrollTo({ top: 0 }); dimensions();
      const saved = readChatPosition(storageKey); const explicit = window.location.hash.match(/^#m-([0-9a-f-]{36})$/i)?.[1]; const ownSend = consumeChatSent(scope);
      let target: Layout = ownSend ? { kind: "bottom" } : explicit ? { kind: "message", id: explicit, flash: true } : saved && !saved.bottom ? { kind: "anchor", position: saved } : seed.firstUnread ? { kind: "message", id: seed.firstUnread } : { kind: "bottom" };
      const anchor = target.kind === "anchor" ? target.position.id : target.kind === "message" ? target.id : null;
      if (enabled && (ownSend || (anchor && !current.messages.some((m) => m.id === anchor)))) {
        fetching = true;
        try { const next = await fetchPage(ownSend ? { mode: "latest" } : { mode: "around", anchor: anchor! }); if (!stopped) commit(next, target); }
        catch { target = seed.firstUnread ? { kind: "message", id: seed.firstUnread } : { kind: "bottom" }; }
        finally { fetching = false; }
      }
      if (stopped) return;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); if (stopped) return;
      booted = true; pendingLayout = target; layout(); scroll.dataset.chatReady = "true"; setReady(true); stats(); save();
      if (queued) { const next = queued; queued = null; void refresh(next); }
    })();
    return () => {
      save(); stopped = true; abort.abort(); clearTimeout(saveTimer); cancelAnimationFrame(animation); cancelAnimationFrame(drainFrame); resized.disconnect(); control.current = null;
      scroll.removeEventListener("scroll", scrolled); scroll.removeEventListener("wheel", interaction); scroll.removeEventListener("touchmove", interaction); scroll.removeEventListener("pointerdown", interaction); scroll.removeEventListener("keydown", interaction);
      window.removeEventListener(READ_EVENT, read); window.removeEventListener(CHAT_JUMP, jumpEvent); window.removeEventListener(CHAT_SENT, sent); window.removeEventListener("hashchange", hash); window.removeEventListener("pagehide", save); window.removeEventListener("blur", save); window.removeEventListener("resize", dimensions);
      window.visualViewport?.removeEventListener("resize", dimensions); window.visualViewport?.removeEventListener("scroll", dimensions);
    };
  }, []);
  const version = initial.revision; const lastVersion = useRef(version);
  useEffect(() => { if (lastVersion.current !== version) { lastVersion.current = version; control.current?.refresh(initial); } }, [version, initial]);
  const disabledQuotes = [...bundle.messages, ...bundle.quotes].filter((m) => m.removed_at).map((m) => m.id);
  return <div ref={frame} className="flex min-h-44 flex-col" style={{ height: "calc(100dvh - 15rem)" }} data-testid="chat-frame">
    <RealtimeRefresh channel={`timeline-${bundle.userId}-${bundle.conversationId}-${bundle.threadId ?? "chat"}`} tables={["messages", "tasks", "task_exchanges", "proposals", "plan_steps", "step_responses", "item_claims", "inbox_items", "business_action_versions", "message_receipt_versions", "message_reaction_versions"]} businessIds={bundle.actions.map(([id]) => id)} filter={`conversation_id=eq.${bundle.conversationId}`} />
    <UnavailableReplies ids={disabledQuotes} />
    <MarkRead conversationId={bundle.conversationId} threadId={bundle.threadId ?? undefined} messageIds={bundle.messages.filter((m) => !m.removed_at && m.sender_user_id !== bundle.userId && (m.sender_user_id || m.sender_agent_id)).map((m) => m.id)} />
    <div className="relative min-h-0 flex-1">
      {!ready && <p role="status" className="absolute inset-x-0 top-0 py-6 text-center text-xs text-muted">Opening conversation…</p>}
      <div ref={viewport} className="h-full overflow-y-auto overscroll-contain px-0.5 py-2 outline-none [overflow-anchor:none]" role="region" aria-label="Chat history" tabIndex={0} data-chat-scroll="" data-chat-ready={ready ? "true" : "false"} data-testid="chat-scroll">
        <div style={{ visibility: ready ? "visible" : "hidden" }}>
          {leading}
          {bundle.hasBefore && <div className="mb-3 text-center"><button type="button" className="text-xs text-accent hover:underline" disabled={busy} onClick={() => control.current?.older()} data-testid="show-earlier">{busy ? "Loading…" : "Load earlier messages"}</button></div>}
          <ol ref={content} className="flex flex-col gap-3" aria-label="Messages"><MessageList bundle={bundle} unreadId={bundle.firstUnread} /></ol>
          {bundle.hasAfter && <div className="mt-3 text-center"><button type="button" className="text-xs text-accent hover:underline" disabled={busy} onClick={() => control.current?.newer()}>Load newer messages</button></div>}
          {error && <p role="alert" className="mt-2 text-center text-xs text-danger">{error} <button type="button" className="underline" onClick={() => control.current?.refresh(initial)}>Retry</button></p>}
        </div>
      </div>
      {ready && down.show && <button type="button" aria-label="Jump to latest message" title="Latest messages" aria-busy={busy} onClick={() => control.current?.latest()} className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground shadow-lg hover:bg-accent-soft" data-testid="jump-to-latest"><svg aria-hidden viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 6 6 6 6-6m-12 6 6 6 6-6" /></svg>{down.count > 0 && <span>{down.count > 99 ? "99+" : down.count} new</span>}</button>}
    </div>
    <div ref={footer} className="max-h-[65%] shrink-0 overflow-y-auto" data-chat-footer="">{children}</div>
  </div>;
}
