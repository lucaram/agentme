"use client";
import { Avatar } from "@/components/Avatar";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { MentionOption, mentionAt } from "@/lib/chat/mentions";

export function useMentionPicker(conversationId: string, getInput: () => HTMLTextAreaElement | null, fit: () => void) {
  const id = useId(); const [token, setToken] = useState<ReturnType<typeof mentionAt>>(null); const [index, setIndex] = useState(0);
  const popup = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<{ query: string; kind: string; options: MentionOption[]; error?: boolean } | null>(null);
  const query = token?.query;
  useEffect(() => {
    if (query === undefined) return; const abort = new AbortController();
    const timer = setTimeout(() => { void fetch(`/api/chats/${conversationId}/mentions?q=${encodeURIComponent(query)}`, { cache: "no-store", signal: abort.signal }).then(async (response) => {
      if (!response.ok) throw new Error(); const data = await response.json(); const options = MentionOption.array().parse(data.options); if (!abort.signal.aborted) setResult({ query, kind: data.kind, options });
    }).catch(() => { if (!abort.signal.aborted) setResult({ query, kind: "", options: [], error: true }); }); }, 120);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [conversationId, query]);
  function detect() {
    const el = getInput(); if (!el) return; const next = mentionAt(el.value, el.selectionStart);
    setToken((old) => old?.start === next?.start && old?.end === next?.end && old?.query === next?.query ? old : next); setIndex(0);
  }
  function insert(handle: string, ask = false) {
    const el = getInput(); if (!el || !token) return;
    const before = el.value.slice(0, token.start); const after = el.value.slice(token.end);
    if (ask) {
      const isMyAgent = result?.kind === "my_agent";
      if (isMyAgent && /^\s*(?:please\s+)?ask\s*$/i.test(before)) el.value = `${before}@${handle}’s agent ${after}`;
      else el.value = `${isMyAgent ? "" : "@agent "}ask @${handle}’s agent ${before}${after}`;
      el.setSelectionRange(el.value.length, el.value.length);
    } else {
      const inserted = `@${handle}${after.startsWith(" ") ? "" : " "}`; el.value = before + inserted + after; el.setSelectionRange(before.length + inserted.length, before.length + inserted.length);
    }
    setToken(null); fit(); el.focus({ preventScroll: true });
  }
  const current = result?.query === query ? result : null;
  const choices: { key: string; label: string; detail: string; avatar: string; choose: () => void }[] = [];
  if (current && current.kind !== "my_agent" && "agent".startsWith(query?.toLowerCase() ?? "")) choices.push({ key: "own", label: "Your agent", detail: "@agent · Private assistance", avatar: "🤖", choose: () => insert("agent") });
  for (const option of current?.options ?? []) {
    choices.push({ key: option.id, label: option.type === "business" ? `Ask ${option.name}’s agent` : current?.kind === "my_agent" ? `${option.name}` : `Mention ${option.name}`, detail: `@${option.handle} · ${option.type === "personal" ? "Person" : "Business agent · AI"}`, avatar: option.avatar, choose: () => insert(option.handle) });
    if (option.type === "personal" && option.can_ask) choices.push({ key: `${option.id}-agent`, label: `Ask ${option.name}’s agent`, detail: "AI · Private request · Approval before sending", avatar: "🤖", choose: () => insert(option.handle, true) });
  }
  const active = Math.min(index, Math.max(0, choices.length - 1));
  useLayoutEffect(() => {
    if (!token) return;
    const position = () => {
      const el = getInput(); const menu = popup.current; if (!el || !menu) return;
      const rect = (el.closest("[data-chat-composer]") ?? el).getBoundingClientRect(); const view = window.visualViewport;
      const left = view?.offsetLeft ?? 0; const top = view?.offsetTop ?? 0; const width = view?.width ?? innerWidth; const height = view?.height ?? innerHeight;
      menu.style.width = `${Math.min(rect.width, width - 16)}px`; menu.style.left = `${Math.max(left + 8, Math.min(rect.left, left + width - menu.offsetWidth - 8))}px`;
      menu.style.maxHeight = `${Math.max(100, Math.min(height * 0.4, rect.top - top - 8))}px`;
      menu.style.top = `${Math.max(top + 8, rect.top - menu.offsetHeight - 6)}px`;
    };
    const outside = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node) && event.target !== getInput()) setToken(null); };
    position(); window.addEventListener("resize", position); window.visualViewport?.addEventListener("resize", position); window.addEventListener("scroll", position, true); document.addEventListener("pointerdown", outside);
    return () => { window.removeEventListener("resize", position); window.visualViewport?.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); document.removeEventListener("pointerdown", outside); };
  }, [getInput, token, choices.length]);
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!token) return false;
    if (event.key === "Escape") { event.preventDefault(); setToken(null); return true; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setIndex((n) => (n + (event.key === "ArrowDown" ? 1 : -1) + Math.max(1, choices.length)) % Math.max(1, choices.length)); return true; }
    if (event.key === "Enter" && choices.length && !event.shiftKey) { event.preventDefault(); choices[active].choose(); return true; } return false;
  }
  return { detect, keyDown, close: () => setToken(null), controls: token ? id : undefined, activeId: token && choices.length ? `${id}-${active}` : undefined,
    panel: token && createPortal(<div ref={popup} className="fixed z-[60] max-h-[40dvh] overflow-y-auto rounded-2xl border border-border bg-surface p-1 shadow-xl" onMouseDown={(event) => event.preventDefault()}>
      <div role="listbox" aria-label="Mention suggestions" id={id}>{choices.map((choice, i) => <button type="button" role="option" aria-label={choice.label} aria-selected={active === i} id={`${id}-${i}`} key={choice.key} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left ${active === i ? "bg-accent-soft" : "hover:bg-accent-soft"}`} onClick={choice.choose}><span className="text-xl" aria-hidden><Avatar value={choice.avatar} /></span><span className="min-w-0"><span className="block text-sm font-medium">{choice.label}</span><span className="block truncate text-xs text-muted">{choice.detail}</span></span></button>)}</div>
      {!current && <p className="px-3 py-2 text-xs text-muted" role="status">Finding people…</p>}{current && !choices.length && <p className="px-3 py-2 text-xs text-muted">{current.error ? "Couldn't load suggestions. Keep typing or try again." : "No matching people or agents here."}</p>}
    </div>, document.body) };
}
