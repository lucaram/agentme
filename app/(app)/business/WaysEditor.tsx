"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KIND_LABEL, MAX_WAYS, WAY_KINDS, normaliseWay, wayLabel, type Way, type WayKind } from "@/lib/business/booking";
import { saveWaysAction } from "./actions";

type Row = { key: number; kind: WayKind; value: string };

/** "How customers book or order": pick what each way is, paste the link or number. */
export function WaysEditor({ initial }: { initial: Way[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => (initial.length ? initial : [{ kind: "book" as WayKind, value: "" }]).map((w, i) => ({ key: i, ...w })));
  const [next, setNext] = useState(rows.length);
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
        start(async () => {
          const result = await saveWaysAction(rows.map(({ kind, value }) => ({ kind, value })));
          setMessage(result.error ? { ok: false, text: result.error } : { ok: true, text: "Saved. Your agent and your page use these straight away." });
          if (!result.error) router.refresh();
        });
      }}
    >
      {rows.map((row, i) => {
        const checked = row.value.trim() ? normaliseWay(row.kind, row.value) : null;
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
            </div>
            {checked && (
              <p className={`text-xs ${checked.ok ? "text-muted" : "text-danger"}`} data-testid="way-preview">
                {checked.ok ? <>Customers see: <span className="font-medium text-foreground">{wayLabel(checked.way)}</span></> : checked.error}
              </p>
            )}
          </div>
        );
      })}
      {rows.length < MAX_WAYS && (
        <button
          type="button"
          className="text-sm font-medium text-accent"
          onClick={() => {
            setRows((rs) => [...rs, { key: next, kind: rows.some((r) => r.kind === "book") ? "call" : "book", value: "" }]);
            setNext((n) => n + 1);
          }}
        >
          ＋ Add another way
        </button>
      )}
      {message && <p className={`text-sm ${message.ok ? "text-accent" : "text-danger"}`} role={message.ok ? "status" : "alert"}>{message.text}</p>}
      <div>
        <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save booking & ordering"}</button>
      </div>
    </form>
  );
}
