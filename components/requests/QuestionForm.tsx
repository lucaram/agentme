"use client";

import { useState, useTransition } from "react";
import { answerInboxAction, declineInboxAction } from "@/app/(app)/actions";

export function QuestionForm({ itemId }: { itemId: string }) {
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      setError(null);
      const result = await fn();
      if (result.error) setError(result.error);
    });

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => answerInboxAction(itemId, { answer }, false));
      }}
    >
      <label className="label" htmlFor={`${itemId}-answer`}>Your answer</label>
      <textarea
        id={`${itemId}-answer`}
        className="input"
        rows={2}
        maxLength={1000}
        required
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
      />
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending}>{pending ? "Sending…" : "Reply"}</button>
        <button type="button" className="btn-ghost" disabled={pending} onClick={() => run(() => declineInboxAction(itemId))}>
          Don&apos;t answer
        </button>
      </div>
    </form>
  );
}
