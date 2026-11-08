"use client";

import { useActionState } from "react";
import { saveGuestAccountAction } from "../people-actions";

export function SaveAccount() {
  const [state, action, pending] = useActionState(saveGuestAccountAction, undefined);
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
      <input className="input" name="email" type="email" autoComplete="email" placeholder="Email" aria-label="Email" required />
      <input className="input" name="password" type="password" autoComplete="new-password" minLength={8} placeholder="Password (8+ characters)" aria-label="Password" required />
      <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save account"}</button>
      {state?.error && <p className="text-sm text-danger sm:col-span-3" role="alert">{state.error}</p>}
    </form>
  );
}
