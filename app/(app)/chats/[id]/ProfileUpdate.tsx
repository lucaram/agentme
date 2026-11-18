"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { answerProfileUpdateAction } from "../../actions";

type Update = { category?: string; action?: "add" | "replace" | "remove" };

/**
 * Something you said about yourself, for "What your agent knows about you": save it, update or remove
 * what's saved (the card shows old and new), or leave it. Nothing changes without a tap.
 */
export function ProfileUpdate({ messageId, update, shared, decided }: { messageId: string; update?: Update; shared?: boolean; decided?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (decided === "saved" || decided === "kept_both") {
    return (
      <p className="mt-1 text-xs text-accent" data-testid="profile-update-done">
        ✓ {decided === "kept_both" ? "Kept both." : update?.action === "remove" ? "Removed." : update?.action === "replace" ? "Updated." : "Saved."}{" "}
        <Link href="/settings/about" className="underline">See what your agent knows</Link>
      </p>
    );
  }
  if (decided) return <p className="mt-1 text-xs text-muted" data-testid="profile-update-done">Not changed.</p>;
  const answer = (choice: "apply" | "keep_both" | "dismiss") =>
    start(async () => {
      const result = await answerProfileUpdateAction(messageId, choice);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  const action = update?.action ?? "add";
  return (
    <div className="mt-1 space-y-1" data-testid="profile-update">
      <p className="text-xs text-muted">
        {update?.category === "notes" ? "🔒 Private notes are never shared." : shared ? "👥 Your contacts' agents can use this when a plan asks for it." : "🔒 Only your agent uses this."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary py-1" disabled={pending} onClick={() => answer("apply")}>
          {action === "remove" ? "Remove" : action === "replace" ? "Update" : "Save"}
        </button>
        {action === "replace" && <button type="button" className="btn-ghost py-1" disabled={pending} onClick={() => answer("keep_both")}>Keep both</button>}
        <button type="button" className="btn-ghost py-1" disabled={pending} onClick={() => answer("dismiss")}>{action === "remove" ? "Keep it" : "Not now"}</button>
        {error && <span className="text-xs text-danger" role="alert">{error}</span>}
      </div>
    </div>
  );
}
