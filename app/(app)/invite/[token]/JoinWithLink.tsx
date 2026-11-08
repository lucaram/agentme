"use client";

import { useState, useTransition } from "react";
import { joinWithLinkAction } from "../../social-actions";

export function JoinWithLink({ token, rules, label }: { token: string; rules: boolean; label: string }) {
  const [accepted, setAccepted] = useState(!rules);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      {rules && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} /> I accept the rules
        </label>
      )}
      <button
        type="button"
        className="btn-primary w-full"
        disabled={pending || !accepted}
        onClick={() =>
          start(async () => {
            const result = await joinWithLinkAction(token, accepted);
            if (result?.error) setMessage({ ok: false, text: result.error });
            else if (result?.status === "requested") setMessage({ ok: true, text: "Request sent. An admin will let you in." });
          })
        }
      >
        {pending ? "Joining…" : label}
      </button>
      {message && <p className={`text-sm ${message.ok ? "text-muted" : "text-danger"}`} role="status">{message.text}</p>}
    </div>
  );
}
