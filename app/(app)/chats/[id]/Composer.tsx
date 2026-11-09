"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendMessage } from "../../actions";

const MAX_HEIGHT = 200; // about 8 lines

export function Composer({
  conversationId,
  threadId,
  placeholder,
  thinkingLabel,
  examples,
  collapseExamples = false,
}: {
  conversationId: string;
  /** My Agent: the request thread this box belongs to ("new" starts one, then opens it). */
  threadId?: string;
  placeholder: string;
  thinkingLabel?: string;
  /** Template chips: clicking one fills the box so the owner can adjust it before sending. */
  examples?: { label: string; text: string }[];
  /** Regular users: the chips stay behind a small "💡 Ideas" button. */
  collapseExamples?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [summoned, setSummoned] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();
  const [showExamples, setShowExamples] = useState(!collapseExamples);

  /** Grow with the text (like ChatGPT/Claude), up to about 8 lines; then scroll. */
  function fit() {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
  }

  function submit() {
    const text = ref.current?.value.trim();
    if (!text || pending) return;
    ref.current!.value = "";
    fit();
    setError(null);
    setSummoned(/^\s*@agent\b/i.test(text));
    startTransition(async () => {
      const result = await sendMessage(conversationId, text, threadId);
      // A new request got its own thread: open it.
      if (result?.threadId && result.threadId !== threadId) router.push(`/chats/${conversationId}?t=${result.threadId}`);
      if (result?.error) {
        setError(result.error);
        // Give the text back so nothing is lost.
        if (ref.current && !ref.current.value) {
          ref.current.value = text;
          fit();
        }
      }
    });
  }

  return (
    <div className="sticky bottom-0 mt-4 bg-background pb-3 pt-2">
      {examples && !showExamples && (
        <button type="button" className="mb-2 text-xs font-medium text-accent hover:underline" onClick={() => setShowExamples(true)}>
          💡 Ideas
        </button>
      )}
      {examples && showExamples && (
        <div className="no-scrollbar mb-2 flex gap-1.5 overflow-x-auto" aria-label="Templates">
          {examples.map((ex) => (
            <button
              key={ex.label}
              type="button"
              className="shrink-0 rounded-full border border-border bg-surface px-3 py-1 text-xs hover:bg-accent-soft"
              onClick={() => {
                if (!ref.current) return;
                ref.current.value = ex.text;
                fit();
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
      {/* One rounded box with the send button inside, like ChatGPT / Claude / Gemini. */}
      <form
        className="flex items-end gap-2 rounded-3xl border border-border bg-surface py-1.5 pl-4 pr-1.5 shadow-sm transition-colors focus-within:border-accent"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={ref}
          aria-label="Message"
          rows={1}
          className="thin-scrollbar block min-h-9 flex-1 resize-none overflow-hidden bg-transparent py-1.5 text-sm leading-6 outline-none placeholder:text-muted"
          placeholder={placeholder}
          onInput={fit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button
          aria-label="Send"
          title="Send (Enter) · New line: Shift+Enter"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-lg font-semibold text-white transition hover:opacity-90 disabled:opacity-50 dark:text-black"
          disabled={pending}
        >
          {pending ? "…" : "↑"}
        </button>
      </form>
    </div>
  );
}
