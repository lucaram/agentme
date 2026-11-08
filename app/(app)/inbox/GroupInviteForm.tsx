"use client";

import { useState, useTransition } from "react";
import { answerGroupInviteAction } from "../social-actions";

export function GroupInviteForm({ itemId }: { itemId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const answer = (accept: boolean) =>
    start(async () => {
      const result = await answerGroupInviteAction(itemId, accept);
      if (result?.error) setError(result.error);
    });
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <button type="button" className="btn-primary" disabled={pending} onClick={() => answer(true)}>Join group</button>
        <button type="button" className="btn-ghost" disabled={pending} onClick={() => answer(false)}>No thanks</button>
      </div>
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
    </div>
  );
}
