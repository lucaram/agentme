"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KIND_LABEL, WAY_KINDS, WAY_PURPOSES, normaliseWay, wayLabel, type Way, type WayKind, type WayPurpose } from "@/lib/business/booking";
import { saveWaysAction } from "./actions";

type Row = { key: number; kind: WayKind; value: string; label?: string; purpose?: WayPurpose; primary?: boolean; /** "Also let your agent read this page" (a custom link). */ read?: boolean };

/**
 * "What customers can tap": pick what each button is, paste the link or number. A custom button for a
 * public document in Website & documents is that document's button: labelled so, its address changed there.
 */
export function WaysEditor({ initial, documents = [] }: { initial: Way[]; documents?: string[] }) {
  const isDocument = (row: Row) => row.kind === "custom" && documents.includes(row.value.trim());
  const router = useRouter();
  const fromSaved = (ways: Way[]) => (ways.length ? ways : [{ kind: "book" as WayKind, value: "" }]).map((w, i) => ({ key: i, ...w }));
  const [rows, setRowsRaw] = useState<Row[]>(() => fromSaved(initial));
  const [next, setNext] = useState(rows.length);
  // Changed here and not saved yet: buttons saved elsewhere (a document's button) wait, so your edits aren't lost.
  const [dirty, setDirty] = useState(false);
  const setRows: typeof setRowsRaw = (value) => { setDirty(true); setRowsRaw(value); };
  // What's saved changed (here or elsewhere): take it in, unless you're in the middle of editing.
  const saved = JSON.stringify([initial, documents]);
  const [seen, setSeen] = useState(saved);
  if (saved !== seen) {
    setSeen(saved);
    if (!dirty) { setRowsRaw(fromSaved(initial)); setNext(Math.max(initial.length, 1)); }
  }
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
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
          const result = await saveWaysAction(rows.map((row) => ({ kind: row.kind, value: row.value, label: row.label, purpose: row.purpose, primary: row.primary, read: row.read && !isDocument(row) })));
          setMessage(result.error ? { ok: false, text: result.error } : { ok: true, text: "Saved. Your agent and your page use these straight away." });
          if (!result.error) setDirty(false);
          if (!result.error) router.refresh();
        });
      }}
    >
      {rows.map((row, i) => {
        const checked = row.value.trim() ? normaliseWay(row.kind, row.value, row) : null;
        const fromDocument = isDocument(row);
        return (
          <div key={row.key} className="space-y-1" data-testid="way-row">
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="input w-auto"
                aria-label={`Way ${i + 1}: what is it`}
                value={row.kind}
                disabled={fromDocument}
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
                readOnly={fromDocument}
                title={fromDocument ? "This button opens a document your agent reads: change its address in Website & documents." : undefined}
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
              <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={row.primary ?? false} onChange={(e) => update(row.key, { primary: e.target.checked })} />Feature this button</label>
            </div>
            {fromDocument ? (
              <p className="text-xs text-muted" data-testid="way-from-document">
                📄 From Website &amp; documents: your agent reads this page. Rename or move the button here; change its address there.
              </p>
            ) : (
              row.kind === "custom" && /^https?:/i.test(row.value.trim()) && (
                <label className="flex items-center gap-2 text-xs text-muted">
                  <input type="checkbox" checked={row.read ?? false} onChange={(e) => update(row.key, { read: e.target.checked })} />
                  Also let your agent read this page (adds it to Website &amp; documents)
                </label>
              )
            )}
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
      <p className="hint">Add as many options as you need. Featured buttons appear first; customers can expand the remaining options.</p>
      {message && <p className={`text-sm ${message.ok ? "text-accent" : "text-danger"}`} role={message.ok ? "status" : "alert"}>{message.text}</p>}
      <div>
        <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save customer actions"}</button>
      </div>
    </form>
  );
}
