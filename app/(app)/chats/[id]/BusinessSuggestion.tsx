"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { answerBusinessSuggestionAction } from "../../actions";

/** "Shall I ask its agent?": Ask @business, or No thanks. Nothing is sent without a tap. */
export function BusinessSuggestion({ messageId, handle, decided }: { messageId: string; handle: string; decided?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (decided === "asked") return <p className="mt-1 text-xs text-accent">✓ Asked @{handle}: the answer is below.</p>;
  if (decided) return <p className="mt-1 text-xs text-muted">Not asked.</p>;
  const answer = (ask: boolean) =>
    start(async () => {
      const result = await answerBusinessSuggestionAction(messageId, ask);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2" data-testid="business-suggestion">
      <button type="button" className="btn-primary py-1" disabled={pending} onClick={() => answer(true)}>
        {pending ? "Asking…" : `Ask @${handle}`}
      </button>
      <button type="button" className="btn-ghost py-1" disabled={pending} onClick={() => answer(false)}>No thanks</button>
      {error && <span className="text-xs text-danger" role="alert">{error}</span>}
    </div>
  );
}
