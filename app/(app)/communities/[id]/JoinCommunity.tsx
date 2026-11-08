"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { joinCommunityAction } from "../../social-actions";

/** Join (public) or ask to join (private); the rules must be accepted first. */
export function JoinCommunity({ id, hasRules, isPrivate }: { id: string; hasRules: boolean; isPrivate: boolean }) {
  const router = useRouter();
  const [accepted, setAccepted] = useState(!hasRules);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      {hasRules && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} /> I accept the rules
        </label>
      )}
      <button
        type="button"
        className="btn-primary"
        disabled={pending || !accepted}
        onClick={() =>
          start(async () => {
            const result = await joinCommunityAction(id, accepted);
            if (result.error) setMessage({ ok: false, text: result.error });
            else if (result.status === "requested") setMessage({ ok: true, text: "Request sent. A moderator will let you in." });
            router.refresh();
          })
        }
      >
        {pending ? "…" : isPrivate ? "Ask to join" : "Join community"}
      </button>
      {message && <p className={`text-sm ${message.ok ? "text-muted" : "text-danger"}`} role="status">{message.text}</p>}
    </div>
  );
}
