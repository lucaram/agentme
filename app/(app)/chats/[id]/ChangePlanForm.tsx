"use client";

import { useState, useTransition } from "react";
import { changePlanAction } from "../../actions";

/** Change block: the organiser edits a shared plan. Day/time changes ask everyone to confirm again. */
export function ChangePlanForm({ proposalId, title, day, time }: { proposalId: string; title: string; day: string; time: string }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({ title, day, time: time || "19:00" });
  const [message, setMessage] = useState<{ kind: "error" | "warning" | "ok"; text: string } | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button type="button" className="mt-3 text-xs text-accent underline" onClick={() => setOpen(true)}>
        Change plan
      </button>
    );
  }

  return (
    <form
      className="mt-3 space-y-2 rounded-xl border border-border p-3"
      aria-label="Change plan"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setMessage(null);
          const result = await changePlanAction(proposalId, values);
          if (result.error) return setMessage({ kind: "error", text: result.error });
          if (result.warnings?.length) return setMessage({ kind: "warning", text: `Updated. Heads-up: ${result.warnings.join(" ")}` });
          setMessage({ kind: "ok", text: "Updated." });
          setOpen(false);
        });
      }}
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-xs sm:col-span-3">
          Name
          <input className="input mt-1" value={values.title} maxLength={120} onChange={(e) => setValues({ ...values, title: e.target.value })} />
        </label>
        <label className="text-xs sm:col-span-2">
          Day
          <input className="input mt-1" value={values.day} maxLength={40} onChange={(e) => setValues({ ...values, day: e.target.value })} />
        </label>
        <label className="text-xs">
          Time
          <input className="input mt-1" type="time" value={values.time} onChange={(e) => setValues({ ...values, time: e.target.value })} />
        </label>
      </div>
      <p className="hint">Changing the day or time asks everyone to confirm again. The change is kept in the history.</p>
      {message && (
        <p role="status" className={`text-xs ${message.kind === "error" ? "text-danger" : message.kind === "warning" ? "text-foreground" : "text-accent"}`}>
          {message.text}
        </p>
      )}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save change"}</button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
