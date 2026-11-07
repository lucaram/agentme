"use client";

import { useState, useTransition } from "react";
import { rsvpAction } from "../../actions";

/**
 * RSVP v2: three states (no answer yet / in / can't make it), always the
 * person's own choice, changeable at any time.
 */
export function RsvpControl({ stepId, current }: { stepId: string; current: "in" | "out" | null }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const choose = (response: "in" | "out") =>
    start(async () => {
      setError(null);
      const result = await rsvpAction(stepId, response);
      if (result.error) setError(result.error);
    });

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted">{current ? "Your answer (you can change it):" : "Are you in?"}</span>
      <div role="radiogroup" aria-label="Your answer" className="inline-flex overflow-hidden rounded-full border border-border">
        {(
          [
            ["in", "I'm in"],
            ["out", "Can't make it"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={current === value}
            disabled={pending}
            onClick={() => current !== value && choose(value)}
            className={`px-4 py-1.5 text-sm transition ${
              current === value ? (value === "in" ? "bg-accent text-white dark:text-black" : "bg-danger text-white") : "bg-surface hover:bg-accent-soft"
            }`}
          >
            {current === value ? (value === "in" ? "✅ " : "❌ ") : ""}
            {label}
          </button>
        ))}
      </div>
      {error && <span className="text-xs text-danger" role="alert">{error}</span>}
    </div>
  );
}
