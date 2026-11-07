"use client";

import { useRef, useTransition } from "react";
import { sendMessage } from "../../actions";

export function Composer({ conversationId, placeholder, thinkingLabel }: { conversationId: string; placeholder: string; thinkingLabel?: string }) {
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const text = ref.current?.value.trim();
    if (!text || pending) return;
    ref.current!.value = "";
    startTransition(() => sendMessage(conversationId, text));
  }

  return (
    <div className="sticky bottom-0 mt-4 bg-background pb-3 pt-2">
      {pending && thinkingLabel && <p className="mb-1 text-xs text-muted" aria-live="polite">{thinkingLabel}</p>}
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
