"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KIND_LABEL, MAX_FEATURED, WAY_KINDS, WAY_PURPOSES, normaliseWay, wayLabel, type Way, type WayKind, type WayPurpose } from "@/lib/business/booking";
import { saveWaysAction } from "./actions";

type Row = { key: number; kind: WayKind; value: string; label?: string; purpose?: WayPurpose; primary?: boolean };

/** "What customers can tap": pick what each button is, paste the link or number. */
export function WaysEditor({ initial }: { initial: Way[] }) {
  const router = useRouter();
  const fromSaved = (ways: Way[]) => (ways.length ? ways : [{ kind: "book" as WayKind, value: "" }]).map((w, i) => ({ key: i, ...w }));
  const [rows, setRowsRaw] = useState<Row[]>(() => fromSaved(initial));
  const [next, setNext] = useState(rows.length);
  // Changed here and not saved yet: a refresh doesn't replace your edits.
  const [dirty, setDirty] = useState(false);
  const setRows: typeof setRowsRaw = (value) => { setDirty(true); setRowsRaw(value); };
  // What's saved changed (here or elsewhere): take it in, unless you're in the middle of editing.
  const saved = JSON.stringify(initial);
  const [seen, setSeen] = useState(saved);
  if (saved !== seen) {
    setSeen(saved);
    if (!dirty) { setRowsRaw(fromSaved(initial)); setNext(Math.max(initial.length, 1)); }
  }
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const featured = rows.filter((row) => row.primary).length;
  const update = (key: number, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setMessage(null);
  };

  return (
    <form
      className="space-y-3"
      aria-label="How customers book or order"
      onSubmit={(e) => {
        e.preventDefault();
        // One button per address (the server checks too).
        const seen = new Set<string>();
        for (const row of rows) {
          const id = `${row.kind}|${row.value.trim()}`;
          if (!row.value.trim()) continue;
          if (seen.has(id)) return setMessage({ ok: false, text: `There's already a button for ${row.value.trim()}. Keep one of them.` });
          seen.add(id);
        }
        start(async () => {
          const result = await saveWaysAction(rows.map((row) => ({ kind: row.kind, value: row.value, label: row.label, purpose: row.purpose, primary: row.primary })));
          setMessage(result.error ? { ok: false, text: result.error } : { ok: true, text: "Saved. Your agent and your page use these straight away." });
          if (!result.error) setDirty(false);
          if (!result.error) router.refresh();
        });
      }}
    >
      {rows.map((row, i) => {
        const checked = row.value.trim() ? normaliseWay(row.kind, row.value, row) : null;
        return (
          <div key={row.key} className="space-y-1" data-testid="way-row">
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="input w-auto"
                aria-label={`Way ${i + 1}: what is it`}
                value={row.kind}
                onChange={(e) => update(row.key, { kind: e.target.value as WayKind })}
              >
                {WAY_KINDS.map((k) => (
                  <option key={k} value={k}>{KIND_LABEL[k].icon} {KIND_LABEL[k].name}</option>
                ))}
              </select>
              <input
                className="input min-w-0 flex-1"
                aria-label={`Way ${i + 1}: link or number`}
                placeholder={KIND_LABEL[row.kind].hint}
                value={row.value}
                onChange={(e) => update(row.key, { value: e.target.value })}
                autoCapitalize="none"
                autoComplete="off"
              />
              <button type="button" className="btn-ghost" aria-label={`Remove way ${i + 1}`} onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}>✕</button>
              <button type="button" className="btn-ghost" aria-label={`Move way ${i + 1} up`} disabled={i === 0} onClick={() => setRows((rs) => { const copy = [...rs]; [copy[i - 1], copy[i]] = [copy[i], copy[i - 1]]; return copy; })}>↑</button>
              <button type="button" className="btn-ghost" aria-label={`Move way ${i + 1} down`} disabled={i === rows.length - 1} onClick={() => setRows((rs) => { const copy = [...rs]; [copy[i], copy[i + 1]] = [copy[i + 1], copy[i]]; return copy; })}>↓</button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input className="input min-w-0 flex-1" aria-label={`Way ${i + 1}: button label`} maxLength={60} value={row.label ?? ""} placeholder={row.kind === "custom" ? "Button label, e.g. Request catering" : "Button label (optional)"} required={row.kind === "custom"} onChange={(e) => update(row.key, { label: e.target.value })} />
              {row.kind === "custom" && <select className="input w-auto" aria-label={`Way ${i + 1}: purpose`} value={row.purpose ?? "information"} onChange={(e) => update(row.key, { purpose: e.target.value as WayPurpose })}>
                {WAY_PURPOSES.map((purpose) => <option key={purpose} value={purpose}>{{ book: "Booking", order: "Ordering", contact: "Contact", information: "Information" }[purpose]}</option>)}
              </select>}
              <label className="flex items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={row.primary ?? false}
                  disabled={!row.primary && featured >= MAX_FEATURED}
                  title={!row.primary && featured >= MAX_FEATURED ? `${MAX_FEATURED} of ${MAX_FEATURED} selected: untick one first.` : undefined}
                  onChange={(e) => update(row.key, { primary: e.target.checked })}
                />
                Show first
              </label>
            </div>
            {checked && (
              <p className={`text-xs ${checked.ok ? "text-muted" : "text-danger"}`} data-testid="way-preview">
                {checked.ok ? <>Customers see: <span className="font-medium text-foreground">{wayLabel(checked.way)}</span></> : checked.error}
              </p>
            )}
          </div>
        );
      })}
      <button
          type="button"
          className="text-sm font-medium text-accent hover:underline"
          onClick={() => {
            setRows((rs) => [...rs, { key: next, kind: rows.some((r) => r.kind === "book") ? "call" : "book", value: "" }]);
            setNext((n) => n + 1);
          }}
        >
          ＋ Add another way
      </button>
      <p className="hint" data-testid="show-first-count">
        <b className="font-medium text-foreground">Show first: {featured} of {MAX_FEATURED} selected.</b> Customers see {MAX_FEATURED} buttons: the ones shown first, then the next in
        your order. The rest are under More options.
      </p>
      {message && <p className={`text-sm ${message.ok ? "text-accent" : "text-danger"}`} role={message.ok ? "status" : "alert"}>{message.text}</p>}
      <div>
        <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save customer actions"}</button>
      </div>
    </form>
  );
}
