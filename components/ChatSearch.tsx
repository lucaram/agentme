"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { searchChatsAction, type ChatHit, type ContactHit } from "@/app/(app)/chats/search-actions";
import { openDirectMessage } from "@/app/(app)/actions";

type Hit = ChatHit | ContactHit;

/**
 * WhatsApp-style search over your chats and contacts, in the header of the
 * Chats tab. Picking a chat opens it; picking a contact opens (or starts)
 * your chat with them.
 */
export function ChatSearch() {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ chats: ChatHit[]; contacts: ContactHit[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pending, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let live = true;
    const timer = setTimeout(async () => {
      const found = await searchChatsAction(q);
      if (live) {
        setResults(found);
        setActive(0);
      }
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (!pathname.startsWith("/chats")) return null;

  const hits: Hit[] = results && query.trim() ? [...results.chats, ...results.contacts] : [];
  const choose = (hit: Hit) => {
    setOpen(false);
    setQuery("");
    setResults(null);
    if (hit.kind === "chat") router.push(`/chats/${hit.id}`);
    else if (hit.chatId) router.push(`/chats/${hit.chatId}`);
    else start(() => openDirectMessage(hit.agentId));
  };

  const row = (hit: Hit, i: number) => (
    <li
      key={hit.kind === "chat" ? hit.id : hit.agentId}
      id={`chat-search-${i}`}
      role="option"
      aria-selected={i === active}
      className={`flex cursor-pointer items-center gap-3 px-3 py-2 ${i === active ? "bg-accent-soft" : ""}`}
      onMouseEnter={() => setActive(i)}
      onMouseDown={(e) => {
        e.preventDefault(); // keep focus until the choice is made
        choose(hit);
      }}
    >
      <span className="text-xl">{hit.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{hit.name}</span>
        <span className="block truncate text-xs text-muted">{hit.kind === "chat" ? hit.detail : `@${hit.handle} · Contact`}</span>
      </span>
    </li>
  );

  return (
    <div ref={box} className="relative mt-2">
      <input
        type="search"
        role="combobox"
        aria-label="Search chats and contacts"
        aria-expanded={open && hits.length > 0}
        aria-controls="chat-search-results"
        aria-activedescendant={open && hits.length ? `chat-search-${active}` : undefined}
        className="input py-1.5 text-sm"
        placeholder="🔍 Search chats and contacts"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (!e.target.value.trim()) setResults(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setQuery("");
            setResults(null);
            setOpen(false);
          } else if (e.key === "ArrowDown" && hits.length) {
            e.preventDefault();
            setActive((a) => (a + 1) % hits.length);
          } else if (e.key === "ArrowUp" && hits.length) {
            e.preventDefault();
            setActive((a) => (a - 1 + hits.length) % hits.length);
          } else if (e.key === "Enter" && hits[active]) {
            e.preventDefault();
            choose(hits[active]);
          }
        }}
      />
      {open && query.trim() && results && (
        <div id="chat-search-results" className="absolute inset-x-0 top-full z-20 mt-1 max-h-96 overflow-y-auto rounded-xl border border-border bg-surface py-1 shadow-lg">
          {hits.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted">No chats or contacts match “{query.trim()}”.</p>
          ) : (
            <ul role="listbox" aria-label="Search results">
              {results.chats.length > 0 && <li role="presentation" className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Chats</li>}
              {results.chats.map((hit, i) => row(hit, i))}
              {results.contacts.length > 0 && <li role="presentation" className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Contacts</li>}
              {results.contacts.map((hit, i) => row(hit, results.chats.length + i))}
            </ul>
          )}
          {pending && <p className="px-3 py-1 text-xs text-muted">Opening…</p>}
        </div>
      )}
    </div>
  );
}
