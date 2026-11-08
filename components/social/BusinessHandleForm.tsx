"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/** "@address" of a business + one button (add to a group, or invite as a partner). */
export function BusinessHandleForm({ action, button, done }: { action: (handle: string) => Promise<{ error?: string }>; button: string; done: string }) {
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (!handle.trim()) return;
        start(async () => {
          const result = await action(handle);
          setMessage(result.error ? { ok: false, text: result.error } : { ok: true, text: done });
          if (!result.error) {
            setHandle("");
            router.refresh();
          }
        });
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted">@</span>
        <input
          className="input min-w-0 flex-1"
          aria-label="Business @address"
          placeholder="business address, e.g. trattoria"
          value={handle}
          onChange={(e) => setHandle(e.target.value.toLowerCase())}
          autoCapitalize="none"
          autoComplete="off"
        />
        <button className="btn-primary" disabled={pending}>{pending ? "…" : button}</button>
      </div>
      {message && (
        <p className={`text-xs ${message.ok ? "text-accent" : "text-danger"}`} role={message.ok ? "status" : "alert"}>{message.text}</p>
      )}
    </form>
  );
}
