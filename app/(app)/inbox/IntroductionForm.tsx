"use client";

import { useState, useTransition } from "react";
import { answerIntroductionAction } from "../people-actions";

export function IntroductionForm({ itemId, name }: { itemId: string; name: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const answer = (accept: boolean) =>
    start(async () => {
      setError(null);
      const result = await answerIntroductionAction(itemId, accept);
      if (result?.error) setError(result.error);
    });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" disabled={pending} onClick={() => answer(true)}>
          {pending ? "…" : `Connect with ${name}`}
        </button>
        <button type="button" className="btn-ghost" disabled={pending} onClick={() => answer(false)}>
          No thanks
        </button>
      </div>
      <p className="hint">You&apos;ll be connected only if you both say yes. If you say no, nobody is told why.</p>
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
    </div>
  );
}
