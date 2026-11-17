"use client";

import { useState } from "react";

/** Copy, or the phone's own share sheet (WhatsApp, Messages, email…) when available. */
export function ShareLink({ url, text, label = "Share", variant = "btn-primary" }: { url: string; text: string; label?: string; variant?: "btn-primary" | "btn-ghost" }) {
  const [done, setDone] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        className={variant}
        onClick={async () => {
          try {
            if (navigator.share) {
              await navigator.share({ text, url });
              return;
            }
          } catch {
            // Share sheet closed: fall back to copying.
          }
          try {
            await navigator.clipboard.writeText(url);
            setDone("Copied ✓");
          } catch {
            setDone("Copy the link above");
          }
        }}
      >
        {label}
      </button>
      {done && <span className="text-xs text-muted" role="status">{done}</span>}
    </span>
  );
}
