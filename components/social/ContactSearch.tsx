"use client";

import { useRef, useState } from "react";

type Person = { id: string; avatar: string; display_name: string; handle: string };

/**
 * Find contacts by name or @handle and add them as chips (submitted as
 * name="members"). Like the Chats search: type, pick, done.
 */
export function ContactSearch({ contacts }: { contacts: Person[] }) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Person[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const q = query.trim().replace(/^@/, "").toLowerCase();
  const chosen = new Set(picked.map((p) => p.id));
  const matches = q
    ? contacts.filter((c) => !chosen.has(c.id) && (c.display_name.toLowerCase().includes(q) || c.handle.toLowerCase().includes(q))).slice(0, 8)
    : [];

  const add = (person: Person) => {
    setPicked((prev) => [...prev, person]);
    setQuery("");
    setActive(0);
    input.current?.focus();
  };

  return (
    <div className="space-y-2">
      {picked.map((p) => <input key={p.id} type="hidden" name="members" value={p.id} />)}
      {picked.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Members to add">
          {picked.map((p) => (
            <li key={p.id} className="flex items-center gap-1 rounded-full bg-accent-soft py-1 pl-3 pr-1 text-sm" data-testid="picked-member">
              {p.avatar} {p.display_name}
              <button
                type="button"
                className="rounded-full px-1.5 text-muted hover:text-danger"
                aria-label={`Remove ${p.display_name}`}
                onClick={() => setPicked((prev) => prev.filter((x) => x.id !== p.id))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-label="Search contacts"
          aria-expanded={open && matches.length > 0}
          aria-controls="member-search-results"
          aria-activedescendant={open && matches.length ? `member-option-${active}` : undefined}
          className="input"
          placeholder={contacts.length ? "🔍 Search your contacts by name or @address" : "Add contacts first (Discover or Contacts)"}
          disabled={!contacts.length}
          value={query}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && matches.length) {
              e.preventDefault();
              setActive((a) => (a + 1) % matches.length);
            } else if (e.key === "ArrowUp" && matches.length) {
              e.preventDefault();
              setActive((a) => (a - 1 + matches.length) % matches.length);
            } else if (e.key === "Enter") {
              e.preventDefault(); // never submit the form from the search box
              if (matches[active]) add(matches[active]);
            } else if (e.key === "Escape") {
              setQuery("");
            }
          }}
        />
        {open && q && (
          <ul id="member-search-results" role="listbox" className="mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-surface py-1">
            {matches.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted">No contacts match “{query.trim()}”.</li>
            ) : (
              matches.map((c, i) => (
                <li
                  key={c.id}
                  id={`member-option-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={`flex cursor-pointer items-center gap-3 px-3 py-2 ${i === active ? "bg-accent-soft" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    add(c);
                  }}
                >
                  <span className="text-xl">{c.avatar}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.display_name}</span>
                    <span className="block truncate text-xs text-muted">@{c.handle}</span>
                  </span>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
