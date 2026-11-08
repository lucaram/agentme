"use client";

import { useRef, useState, useTransition } from "react";
import { sendMessage } from "../../actions";

export function Composer({
  conversationId,
  placeholder,
  thinkingLabel,
  examples,
}: {
  conversationId: string;
  placeholder: string;
  thinkingLabel?: string;
  /** Template chips: clicking one fills the box so the owner can adjust it before sending. */
  examples?: { label: string; text: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [summoned, setSummoned] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const text = ref.current?.value.trim();
    if (!text || pending) return;
    ref.current!.value = "";
    setError(null);
    setSummoned(/^\s*@agent\b/i.test(text));
    startTransition(async () => {
      const result = await sendMessage(conversationId, text);
      if (result?.error) {
        setError(result.error);
        // Give the text back so nothing is lost.
        if (ref.current && !ref.current.value) ref.current.value = text;
      }
    });
  }

  return (
    <div className="sticky bottom-0 mt-4 bg-background pb-3 pt-2">
      {examples && (
        <div className="no-scrollbar mb-2 flex gap-1.5 overflow-x-auto" aria-label="Templates">
          {examples.map((ex) => (
            <button
              key={ex.label}
              type="button"
              className="shrink-0 rounded-full border border-border bg-surface px-3 py-1 text-xs hover:bg-accent-soft"
              onClick={() => {
                if (!ref.current) return;
                ref.current.value = ex.text;
                ref.current.focus();
              }}
            >
              {ex.label}
            </button>
          ))}
        </div>
      )}
      {pending && (thinkingLabel || summoned) && (
        <p className="mb-1 text-xs text-muted" aria-live="polite">{thinkingLabel ?? "Your agent is thinking… (only you will see the answer)"}</p>
      )}
      {error && <p className="mb-1 text-xs text-danger" role="alert">{error}</p>}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={ref}
          aria-label="Message"
          rows={1}
          className="input max-h-40 min-h-10 resize-none"
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button className="btn-primary" disabled={pending}>Send</button>
      </form>
    </div>
  );
}
