"use client";

import { useState, useTransition } from "react";
import type { PlanDraft, StepDraft } from "@/lib/plans/compose";
import { updateDraftAction } from "../../actions";

const LABELS: Record<string, string> = {
  collect: "🗓️ Find a time with their agents",
  rsvp: "📨 Who's in",
  poll: "📊 Poll",
  question: "💬 Question",
  assign: "🧺 Sign-up list",
  announce: "📣 Announcement",
};

const toList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/**
 * Editable preview of a composed plan. The proposal step is managed
 * automatically (it always follows "find a time"), so it isn't shown here.
 * Saving runs the same code checks on the server as a freshly composed plan.
 */
export function DraftEditor({ taskId, initial }: { taskId: string; initial: PlanDraft }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(initial.title);
  const [steps, setSteps] = useState<StepDraft[]>(initial.steps.filter((s) => s.type !== "proposal"));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const hasCollect = steps.some((s) => s.type === "collect");
  const set = (i: number, patch: Partial<StepDraft>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  if (!open) {
    return (
      <button type="button" className="mt-2 text-xs text-accent underline" onClick={() => setOpen(true)}>
        Edit plan
      </button>
    );
  }

  return (
    <form
      className="mt-3 space-y-3 rounded-xl border border-border p-3"
      aria-label="Edit plan"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const result = await updateDraftAction(taskId, { kind: "plan", title, steps });
          if (result.error) setError(result.error);
          else setOpen(false);
        });
      }}
    >
      <label className="block text-xs">
        Plan name
        <input className="input mt-1" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
      </label>

      {steps.map((s, i) => (
        <fieldset key={`${s.type}-${i}`} className="space-y-2 rounded-lg border border-border p-2" data-testid={`edit-${s.type}`}>
          <legend className="flex w-full items-center justify-between px-1 text-xs font-medium">
            {LABELS[s.type] ?? s.type}
            {steps.length > 1 && (
              <button type="button" className="ml-2 text-danger" onClick={() => setSteps(steps.filter((_, j) => j !== i))} aria-label={`Remove ${LABELS[s.type]}`}>
                Remove
              </button>
            )}
          </legend>

          {s.type === "collect" && (
            <>
              <label className="block text-xs">
                When
                <input className="input mt-1" value={s.window} maxLength={80} onChange={(e) => set(i, { window: e.target.value })} />
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={s.categories.includes("food")}
                  onChange={(e) => set(i, { categories: e.target.checked ? [...new Set([...s.categories, "food" as const])] : s.categories.filter((c) => c !== "food") })}
                />
                Also ask for food preferences
              </label>
            </>
          )}

          {s.type === "rsvp" && (
            <div className="grid gap-2 sm:grid-cols-4">
              {!hasCollect && (
                <>
                  <label className="text-xs sm:col-span-2">
                    Event
                    <input className="input mt-1" value={s.event} maxLength={60} onChange={(e) => set(i, { event: e.target.value })} />
                  </label>
                  <label className="text-xs">
                    Day
                    <input className="input mt-1" value={s.window} maxLength={40} onChange={(e) => set(i, { window: e.target.value })} />
                  </label>
                  <label className="text-xs">
                    Time
                    <input className="input mt-1" type="time" value={s.time} onChange={(e) => set(i, { time: e.target.value })} />
                  </label>
                </>
              )}
              <label className="text-xs">
                At least
                <input className="input mt-1" type="number" min={0} max={20} value={s.min || ""} onChange={(e) => set(i, { min: Number(e.target.value) || 0 })} />
              </label>
              <label className="text-xs">
                At most
                <input className="input mt-1" type="number" min={0} max={20} value={s.max || ""} onChange={(e) => set(i, { max: Number(e.target.value) || 0 })} />
              </label>
            </div>
          )}

          {(s.type === "poll" || s.type === "question") && (
            <label className="block text-xs">
              {s.type === "poll" ? "Question" : "What to ask"}
              <input className="input mt-1" value={s.question} maxLength={500} onChange={(e) => set(i, { question: e.target.value })} />
            </label>
          )}
          {s.type === "poll" && (
            <label className="block text-xs">
              Options (comma-separated, 2–6)
              <input className="input mt-1" value={s.options.join(", ")} onChange={(e) => set(i, { options: toList(e.target.value) })} />
            </label>
          )}
          {s.type === "assign" && (
            <label className="block text-xs">
              Items (comma-separated)
              <input className="input mt-1" value={s.items.join(", ")} onChange={(e) => set(i, { items: toList(e.target.value) })} />
            </label>
          )}
          {s.type === "announce" && (
            <label className="block text-xs">
              Message (sent exactly as written)
              <textarea className="input mt-1" rows={2} value={s.message} maxLength={1000} onChange={(e) => set(i, { message: e.target.value })} />
            </label>
          )}
        </fieldset>
      ))}

      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save plan"}</button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
