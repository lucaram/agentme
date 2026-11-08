"use client";

import { useState, useTransition } from "react";
import { answerInboxAction, declineInboxAction } from "@/app/(app)/actions";

export type InboxField = { category: string; label: string; value: string; alreadyShared: boolean; required: boolean };

export function InboxItemForm({ itemId, fields }: { itemId: string; fields: InboxField[] }) {
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(fields.map((f) => [f.category, f.value])));
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      setError(null);
      const result = await fn();
      if (result.error) setError(result.error);
    });

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => answerInboxAction(itemId, values, remember));
      }}
    >
      {fields.map((f) => (
        <div key={f.category}>
          <label className="label" htmlFor={`${itemId}-${f.category}`}>
            {f.label}
            {f.alreadyShared && <span className="ml-2 text-xs font-normal text-muted">(your agent shares this anyway)</span>}
          </label>
          <input
            id={`${itemId}-${f.category}`}
            className="input"
            value={values[f.category] ?? ""}
            maxLength={200}
            required={f.required}
            readOnly={f.alreadyShared}
            onChange={(e) => setValues({ ...values, [f.category]: e.target.value })}
          />
        </div>
      ))}
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Let my agent share this with my contacts&apos; agents automatically next time
      </label>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending}>{pending ? "Sending…" : "Share answer"}</button>
        <button type="button" className="btn-ghost" disabled={pending} onClick={() => run(() => declineInboxAction(itemId))}>
          Don&apos;t share
        </button>
      </div>
    </form>
  );
}
