"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

function Inner({ label, pendingLabel, variant, block }: { label: string; pendingLabel?: string; variant: string; block?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className={`${variant}${block ? " w-full" : ""}`} disabled={pending}>
      {pending ? pendingLabel ?? "…" : label}
    </button>
  );
}

/**
 * A one-button form that runs a (bound) server action, with a pending state.
 * If the action returns `{ error }`, the message is shown next to the button.
 */
export function ActionButton({
  action,
  label,
  pendingLabel,
  variant = "btn-ghost",
  block = false,
}: {
  action: () => Promise<unknown>;
  label: string;
  pendingLabel?: string;
  variant?: "btn-primary" | "btn-ghost" | "btn-danger";
  /** Full width (e.g. the main action on a phone-sized page). */
  block?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className={`flex flex-col gap-1 ${block ? "items-stretch text-center" : "items-end"}`}
      action={async () => {
        setError(null);
        const result = await action();
        if (result && typeof result === "object" && "error" in result && typeof result.error === "string") setError(result.error);
      }}
    >
      <Inner label={label} pendingLabel={pendingLabel} variant={variant} block={block} />
      {error && <span className="max-w-56 text-right text-xs text-danger" role="alert">{error}</span>}
    </form>
  );
}
