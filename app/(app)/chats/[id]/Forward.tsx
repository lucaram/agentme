"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { forwardAction, forwardPlacesAction } from "../../forward-actions";
import type { ForwardPlace, ForwardResult } from "@/lib/social/forward-server";

type Loaded = { places: ForwardPlace[]; limit: number; label: string };

/** "↪ Forward" under a message (e.g. a business's answer in My Agent). */
export function ForwardButton({ messageId }: { messageId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => setOpen(true)} data-testid="forward-button">
        ↪ Forward
      </button>
      {open && <ForwardPicker messageId={messageId} onClose={() => setOpen(false)} />}
    </>
  );
}

const GROUP_TITLE: Record<ForwardPlace["kind"], string> = { contact: "Contacts", group: "Groups", community: "Communities" };

/**
 * Pick up to 5 chats (1 if it was forwarded many times). You send it, as your
 * own forward, labelled so people know where it came from.
 */
export function ForwardPicker({ messageId, onClose }: { messageId: string; onClose: () => void }) {
  const [data, setData] = useState<Loaded | { error: string } | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [results, setResults] = useState<ForwardResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    void forwardPlacesAction(messageId).then((r) => live && setData(r));
    return () => {
      live = false;
    };
  }, [messageId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const loaded = data && "places" in data ? data : null;
  const q = query.trim().toLowerCase();
  const shown = (loaded?.places ?? []).filter((p) => !q || `${p.name} ${p.detail}`.toLowerCase().includes(q));
  const toggle = (key: string) =>
    setPicked((list) => (list.includes(key) ? list.filter((k) => k !== key) : loaded && list.length < loaded.limit ? [...list, key] : list));

  const send = () =>
    start(async () => {
      setError(null);
      const r = await forwardAction(messageId, picked);
      if (r.error) setError(r.error);
      else setResults(r.results ?? []);
    });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-md space-y-3 rounded-2xl border border-border bg-raised p-4 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Forward"
        onClick={(e) => e.stopPropagation()}
        data-testid="forward-picker"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">↪ Forward</h2>
          <button type="button" className="rounded-lg px-2 py-1 text-muted hover:bg-accent-soft" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>

        {!data && <p className="text-sm text-muted">Loading your chats…</p>}
        {data && "error" in data && <p className="text-sm text-danger" role="alert">{data.error}</p>}

        {results ? (
          <div className="space-y-3">
            <ul className="space-y-1.5 text-sm" data-testid="forward-results">
              {results.map((r) => (
                <li key={r.key} className={r.ok ? "" : "text-danger"}>
                  {r.ok ? (
                    <>
                      ✓ Sent to{" "}
                      {r.conversationId ? (
                        <Link href={`/chats/${r.conversationId}`} className="underline">
                          {r.name}
                        </Link>
                      ) : (
                        r.name
                      )}
                    </>
                  ) : (
                    <>
                      ✕ {r.name}: {r.error}
                    </>
                  )}
                </li>
              ))}
            </ul>
            <button type="button" className="btn-primary w-full" onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          loaded && (
            <>
              <p className="rounded-xl bg-accent-soft px-3 py-2 text-xs">
                People will see it as <b>{loaded.label}</b>, sent by you.{" "}
                {loaded.limit === 1 ? "It was forwarded many times, so it goes to one chat at a time." : `Up to ${loaded.limit} chats.`}
              </p>
              <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search contacts, groups, communities" aria-label="Search chats" />
              <div className="max-h-72 space-y-3 overflow-y-auto">
                {loaded.places.length === 0 && <p className="text-sm text-muted">No chats yet: add contacts or join a group first.</p>}
                {(["contact", "group", "community"] as const).map((kind) => {
                  const list = shown.filter((p) => p.kind === kind);
                  if (!list.length) return null;
                  return (
                    <div key={kind}>
                      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{GROUP_TITLE[kind]}</h3>
                      <ul className="space-y-1">
                        {list.map((p) => {
                          const on = picked.includes(p.key);
                          const full = !on && picked.length >= loaded.limit;
                          return (
                            <li key={p.key}>
                              <label className={`flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm ${on ? "bg-accent-soft" : "hover:bg-accent-soft"} ${full ? "opacity-50" : ""}`}>
                                <input type="checkbox" checked={on} disabled={full} onChange={() => toggle(p.key)} aria-label={p.name} />
                                <span aria-hidden>{p.avatar}</span>
                                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                                <span className="shrink-0 text-xs text-muted">{p.detail}</span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
              {error && <p className="text-sm text-danger" role="alert">{error}</p>}
              <button type="button" className="btn-primary w-full" disabled={pending || !picked.length} onClick={send}>
                {pending ? "Forwarding…" : picked.length ? `↪ Forward to ${picked.length} ${picked.length === 1 ? "chat" : "chats"}` : "Choose where to forward it"}
              </button>
            </>
          )
        )}
      </div>
    </div>
  );
}
