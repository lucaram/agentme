"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { answerFactSuggestionAction } from "../../actions";

/** "Shall I remember …?": Save to your profile, or No thanks. Nothing is saved without a tap. */
export function FactSuggestion({ messageId, decided }: { messageId: string; decided?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (decided === "saved") {
    return (
      <p className="mt-1 text-xs text-accent" data-testid="fact-saved">
        ✓ Saved. <Link href="/settings/about" className="underline">See what your agent knows</Link>
      </p>
    );
  }
  if (decided) return <p className="mt-1 text-xs text-muted">Not saved.</p>;
  const answer = (accept: boolean) =>
    start(async () => {
      const result = await answerFactSuggestionAction(messageId, accept);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2" data-testid="fact-suggestion">
      <button type="button" className="btn-primary py-1" disabled={pending} onClick={() => answer(true)}>Save</button>
      <button type="button" className="btn-ghost py-1" disabled={pending} onClick={() => answer(false)}>No thanks</button>
      {error && <span className="text-xs text-danger" role="alert">{error}</span>}
    </div>
  );
}
