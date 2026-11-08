"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addFaqAction, removeFaqAction, updateFaqAction } from "./actions";

type Faq = { q: string; a: string };

function FaqEditor({ initial, onSave, onCancel, saveLabel }: { initial: Faq; onSave: (f: Faq) => Promise<{ error?: string }>; onCancel?: () => void; saveLabel: string }) {
  const [q, setQ] = useState(initial.q);
  const [a, setA] = useState(initial.a);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} maxLength={300} placeholder="Question, e.g. Do you have vegetarian options?" aria-label="Question" />
      <textarea className="input" rows={2} value={a} onChange={(e) => setA(e.target.value)} maxLength={1000} placeholder="Your answer" aria-label="Answer" />
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={pending || !q.trim() || !a.trim()}
          onClick={() =>
            start(async () => {
              const result = await onSave({ q, a });
              if (result.error) setError(result.error);
              else {
                setError(null);
                if (!onCancel) {
                  setQ("");
                  setA("");
                }
              }
            })
          }
        >
          {pending ? "Saving…" : saveLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

/** Questions & answers your agent uses: add, edit, remove. */
export function QuestionsAnswers({ faqs }: { faqs: Faq[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  const done = async (result: { error?: string }) => {
    if (!result.error) {
      setEditing(null);
      router.refresh();
    }
    return result;
  };

  return (
    <div className="space-y-3">
      {faqs.length > 0 && (
        <ul className="divide-y divide-border" data-testid="faq-list">
          {faqs.map((f, i) =>
            editing === i ? (
              <li key={i} className="py-2">
                <FaqEditor initial={f} saveLabel="Save" onCancel={() => setEditing(null)} onSave={async (next) => done(await updateFaqAction(i, next.q, next.a))} />
              </li>
            ) : (
              <li key={i} className="flex items-start gap-2 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{f.q}</span>
                  <span className="block text-muted">{f.a}</span>
                </span>
                <button type="button" className="btn-ghost" onClick={() => setEditing(i)}>Edit</button>
                <button type="button" className="btn-ghost" disabled={pending} onClick={() => start(async () => { await removeFaqAction(i); router.refresh(); })}>
                  Remove
                </button>
              </li>
            ),
          )}
        </ul>
      )}
      {adding ? (
        <FaqEditor
          initial={{ q: "", a: "" }}
          saveLabel="Add"
          onCancel={() => setAdding(false)}
          onSave={async (f) => {
            const result = await addFaqAction(f.q, f.a);
            if (!result.error) {
              setAdding(false);
              router.refresh();
            }
            return result;
          }}
        />
      ) : (
        <button type="button" className="btn-ghost" onClick={() => setAdding(true)}>＋ Add a question</button>
      )}
    </div>
  );
}
