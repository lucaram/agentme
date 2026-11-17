"use client";
import { Avatar } from "@/components/Avatar";


import { useEffect, useId, useRef, useState } from "react";
import { searchBusinessStaff, type StaffSearchHit } from "@/app/(app)/business/staff-actions";

export function StaffPicker({ selected, onPick, disabled }: { selected: StaffSearchHit | null; onPick: (person: StaffSearchHit | null) => void; disabled: boolean }) {
  const [query, setQuery] = useState(""); const [open, setOpen] = useState(false); const [active, setActive] = useState(0);
  const [result, setResult] = useState<{ query: string; hits: StaffSearchHit[]; error?: string }>();
  const input = useRef<HTMLInputElement>(null); const listId = useId(); const q = query.trim();
  useEffect(() => {
    if (selected || q.replace(/^@/, "").length < 2) return;
    let live = true;
    const timer = setTimeout(async () => {
      try { const found = await searchBusinessStaff(q); if (live) setResult({ query: q, ...found }); }
      catch { if (live) setResult({ query: q, hits: [], error: "Couldn't search. Please try again." }); }
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [q, selected]);
  const matches = result?.query === q ? result.hits : [];
  const showing = open && !selected && q.replace(/^@/, "").length >= 2;
  const pick = (person: StaffSearchHit) => { onPick(person); setQuery(""); setOpen(false); setActive(0); };
  return <div className="min-w-0 flex-1">
    {selected ? <div className="flex items-center gap-3 rounded-xl border border-accent bg-accent-soft p-3" data-testid="selected-staff">
      <span className="text-2xl" aria-hidden><Avatar value={selected.avatar} /></span><span className="min-w-0 flex-1"><b className="block truncate text-sm">{selected.name}</b><span className="block truncate text-xs text-muted">@{selected.handle}</span></span>
      <button type="button" className="btn-ghost text-sm" disabled={disabled} onClick={() => { onPick(null); setQuery(""); setOpen(true); requestAnimationFrame(() => input.current?.focus()); }}>Change person</button>
    </div> : <div onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <input ref={input} className="input" role="combobox" aria-label="Search people to invite" placeholder="Search by name or @address" autoComplete="off" autoCapitalize="none" maxLength={60} disabled={disabled} value={query}
        aria-expanded={showing} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={showing && matches[active] ? `${listId}-${active}` : undefined}
        onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && matches.length) { event.preventDefault(); setOpen(true); setActive((value) => (value + 1) % matches.length); }
          else if (event.key === "ArrowUp" && matches.length) { event.preventDefault(); setActive((value) => (value - 1 + matches.length) % matches.length); }
          else if (event.key === "Enter") { event.preventDefault(); if (showing && matches[active]) pick(matches[active]); }
          else if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
        }} />
      {showing && <ul id={listId} role="listbox" aria-label="People to invite" className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-border bg-surface p-1">
        {result?.query !== q ? <li className="px-3 py-2 text-sm text-muted" role="presentation">Searching…</li> : result.error ? <li role="presentation" className="px-3 py-2 text-sm text-danger">{result.error}</li> : !matches.length ? <li role="presentation" className="px-3 py-2 text-sm text-muted">No eligible users found. Try their exact @address.</li> : matches.map((person, index) => <li role="presentation" key={person.id}>
          <button type="button" role="option" id={`${listId}-${index}`} aria-selected={index === active} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${index === active ? "bg-accent-soft" : "hover:bg-accent-soft"}`} onMouseEnter={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => pick(person)}>
            <span className="text-2xl" aria-hidden><Avatar value={person.avatar} /></span><span className="min-w-0"><span className="block truncate text-sm font-medium">{person.name}</span><span className="block truncate text-xs text-muted">@{person.handle}</span></span>
          </button></li>)}
      </ul>}
    </div>}
  </div>;
}
