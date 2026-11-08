"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { searchAction, type SearchHit, type SearchScope, type SearchSection } from "@/app/(app)/chats/search-actions";
import { openDirectMessage } from "@/app/(app)/actions";

/** The tab you're on decides what the header search looks for. */
function scopeFor(pathname: string): SearchScope | null {
  if (pathname.startsWith("/chats")) return "chats";
  if (pathname.startsWith("/contacts") || pathname.startsWith("/discover")) return "contacts";
  if (pathname.startsWith("/groups")) return "groups";
  if (pathname.startsWith("/communities")) return "communities";
  return null;
}

const PLACEHOLDER: Record<SearchScope, string> = {
  chats: "🔍 Search chats and contacts",
  contacts: "🔍 Search your contacts",
  groups: "🔍 Search your groups",
  communities: "🔍 Search communities",
};

/**
 * One search bar in the header, WhatsApp-style, that searches whatever the
 * current tab is about: chats & contacts, contacts, your groups, or
 * communities (yours and public ones). Picking a result opens it.
 */
export function ChatSearch() {
  const pathname = usePathname();
  const router = useRouter();
  const scope = scopeFor(pathname);
  const [query, setQuery] = useState("");
  const [sections, setSections] = useState<SearchSection[] | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pending, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q || !scope) return;
    let live = true;
    const timer = setTimeout(async () => {
      const found = await searchAction(scope, q);
      if (live) {
        setSections(found);
        setActive(0);
      }
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, scope]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (!scope) return null;

  const hits: SearchHit[] = sections && query.trim() ? sections.flatMap((s) => s.hits) : [];
  const choose = (hit: SearchHit) => {
    setOpen(false);
    setQuery("");
    setSections(null);
    if (hit.href) router.push(hit.href);
    else if (hit.openDmWith) start(() => openDirectMessage(hit.openDmWith!));
  };

  // Position of each section's first result in the flat list (for the keyboard).
  const starts = (sections ?? []).map((_, k) => (sections ?? []).slice(0, k).reduce((n, x) => n + x.hits.length, 0));
  return (
    <div ref={box} className="relative mt-2">
      <input
        key={scope} // switching tabs starts a fresh search
        type="search"
        role="combobox"
        aria-label={PLACEHOLDER[scope].replace("🔍 ", "")}
        aria-expanded={open && hits.length > 0}
        aria-controls="header-search-results"
        aria-activedescendant={open && hits.length ? `header-search-${active}` : undefined}
        className="input py-1.5 text-sm"
        placeholder={PLACEHOLDER[scope]}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (!e.target.value.trim()) setSections(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setQuery("");
            setSections(null);
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
      {open && query.trim() && sections && (
        <div id="header-search-results" className="absolute inset-x-0 top-full z-20 mt-1 max-h-96 overflow-y-auto rounded-xl border border-border bg-surface py-1 shadow-lg">
          {hits.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted">Nothing matches “{query.trim()}”.</p>
          ) : (
            <ul role="listbox" aria-label="Search results">
              {sections.map((section, k) => (
                <li key={section.title} role="presentation">
                  <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{section.title}</p>
                  <ul role="presentation">
                    {section.hits.map((hit, j) => {
                      const i = starts[k] + j;
                      return (
                        <li
                          key={hit.key}
                          id={`header-search-${i}`}
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
                            <span className="block truncate text-xs text-muted">{hit.detail}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          {pending && <p className="px-3 py-1 text-xs text-muted">Opening…</p>}
        </div>
      )}
    </div>
  );
}
