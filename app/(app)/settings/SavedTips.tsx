"use client";

import { useState, useTransition } from "react";
import { addTipAction, removeTipAction } from "../people-actions";

type Tip = { id: string; topic: string; tip: string };

/** Tips your agent may share by itself when a friend asks around about that topic. */
export function SavedTips({ tips }: { tips: Tip[] }) {
  const [topic, setTopic] = useState("");
  const [tip, setTip] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      {tips.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border" data-testid="saved-tips">
          {tips.map((t) => (
            <li key={t.id} className="flex items-start gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t.topic}</span>
                <span className="block text-muted">{t.tip}</span>
              </span>
              <button type="button" className="text-xs text-muted underline" disabled={pending} onClick={() => start(async () => { await removeTipAction(t.id); })}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
        <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={80} placeholder="Topic, e.g. plumber" aria-label="Tip topic" />
        <input className="input" value={tip} onChange={(e) => setTip(e.target.value)} maxLength={500} placeholder="Your tip, e.g. Joe's Plumbing, 020 7946 0000" aria-label="Tip" />
        <button
          type="button"
          className="btn-primary"
          disabled={pending || !topic.trim() || !tip.trim()}
          onClick={() =>
            start(async () => {
              const result = await addTipAction(topic, tip);
              if (result.error) setError(result.error);
              else {
                setTopic("");
                setTip("");
                setError(null);
              }
            })
          }
        >
          Add tip
        </button>
      </div>
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
    </div>
  );
}
