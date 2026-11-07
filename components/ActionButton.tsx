"use client";

import { useFormStatus } from "react-dom";

function Inner({ label, pendingLabel, variant }: { label: string; pendingLabel?: string; variant: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={variant} disabled={pending}>
      {pending ? pendingLabel ?? "…" : label}
    </button>
  );
}

/** A one-button form that runs a (bound) server action, with a pending state. */
export function ActionButton({
  action,
  label,
  pendingLabel,
  variant = "btn-ghost",
}: {
  action: () => Promise<unknown>;
  label: string;
  pendingLabel?: string;
  variant?: "btn-primary" | "btn-ghost" | "btn-danger";
}) {
  return (
    <form action={async () => void (await action())}>
      <Inner label={label} pendingLabel={pendingLabel} variant={variant} />
    </form>
  );
}
