"use client";

import { useState, useTransition } from "react";
import { answerInboxAction, declineInboxAction } from "@/app/(app)/actions";

/** A contact's question, or (askAround) a friend asking for a recommendation. */
export function QuestionForm({ itemId, askAround = false }: { itemId: string; askAround?: boolean }) {
  const [answer, setAnswer] = useState("");
  const [saveTip, setSaveTip] = useState(true);
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
        run(() => answerInboxAction(itemId, { answer }, askAround && saveTip));
      }}
    >
      <label className="label" htmlFor={`${itemId}-answer`}>{askAround ? "Your tip" : "Your answer"}</label>
      <textarea
        id={`${itemId}-answer`}
        className="input"
        rows={2}
        maxLength={1000}
        required
        placeholder={askAround ? "e.g. Joe's Plumbing, 020 7946 0000. Quick and fair." : undefined}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
      />
      {askAround && (
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={saveTip} onChange={(e) => setSaveTip(e.target.checked)} />
          Also save as a tip, so my agent can share it next time someone asks
        </label>
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending}>{pending ? "Sending…" : askAround ? "Share tip" : "Reply"}</button>
        <button type="button" className="btn-ghost" disabled={pending} onClick={() => run(() => declineInboxAction(itemId))}>
          {askAround ? "I don't know" : <>Don&apos;t answer</>}
        </button>
      </div>
    </form>
  );
}
