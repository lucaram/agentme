"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Hit = { id: string; handle: string; display_name: string; avatar: string; bio: string | null };

/**
 * Search businesses by name or @address and pick one (add it to a group, or
 * invite it as a community partner). Only businesses that answer anyone show up.
 */
export function BusinessHandleForm({
  action,
  search,
  exclude = [],
  button,
  done,
}: {
  action: (handle: string) => Promise<{ error?: string }>;
  search: (query: string, exclude: string[]) => Promise<Hit[]>;
  /** Businesses already here (not suggested again). */
  exclude?: string[];
  button: string;
  done: string;
}) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [searched, setSearched] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const excludeKey = exclude.join(",");

  // Search as you type (debounced); results are only shown for the current text.
  useEffect(() => {
    const q = query.trim();
    if (q.replace(/^@/, "").length < 2) return;
    let live = true;
    const timer = setTimeout(async () => {
      const found = await search(q, excludeKey ? excludeKey.split(",") : []);
      if (live) {
        setHits(found);
        setSearched(q);
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, search, excludeKey]);

  // A confirmation fades after a few seconds (and on typing), so it never outlives what it describes.
  useEffect(() => {
    if (!message?.ok) return;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  const showing = query.trim().replace(/^@/, "").length >= 2 && searched === query.trim();
  const pick = (hit: Hit) =>
    start(async () => {
      const result = await action(hit.handle);
      setMessage(result.error ? { ok: false, text: result.error } : { ok: true, text: `${hit.display_name}: ${done}` });
      if (!result.error) {
        setQuery("");
        setHits([]);
        router.refresh();
      }
    });

  return (
    <div className="space-y-2">
      <input
        className="input"
        role="combobox"
        aria-label="Search businesses"
        aria-expanded={showing}
        aria-controls={listId}
        placeholder="Search businesses by name or @address"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setMessage(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (showing && hits[0]) pick(hits[0]);
          }
        }}
        autoCapitalize="none"
        autoComplete="off"
      />
      {showing && (
        <ul id={listId} role="listbox" aria-label="Businesses found" className="divide-y divide-border rounded-xl border border-border">
          {hits.length === 0 && <li className="px-3 py-2 text-sm text-muted">No business found. Businesses that only talk to their own customers can&apos;t be added.</li>}
          {hits.map((h) => (
            <li key={h.id} role="option" aria-selected={false} className="flex items-center gap-3 px-3 py-2">
              <span className="text-xl">{h.avatar}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{h.display_name}</span>
                <span className="block truncate text-xs text-muted">@{h.handle}{h.bio ? ` · ${h.bio}` : ""}</span>
              </span>
              <button type="button" className="btn-primary" disabled={pending} onClick={() => pick(h)}>
                {pending ? "…" : button}
              </button>
            </li>
          ))}
        </ul>
      )}
      {message && (
        <p className={`text-xs ${message.ok ? "text-accent" : "text-danger"}`} role={message.ok ? "status" : "alert"}>{message.text}</p>
      )}
    </div>
  );
}
