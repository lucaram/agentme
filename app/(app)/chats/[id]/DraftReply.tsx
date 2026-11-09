"use client";

import { useState, useTransition } from "react";
import { sendDraftAction } from "../../actions";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";

/** A reply drafted by the owner's agent: editable, sent only when the owner taps "Send as me". */
export function DraftReply({ conversationId, messageId, draft, sent }: { conversationId: string; messageId: string; draft: string; sent: boolean }) {
  const [text, setText] = useState(draft);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (sent) return <p className="mt-1 text-xs text-muted">Sent ✓</p>;
  return (
    <form
      className="mt-2 w-full max-w-[85%] space-y-2 rounded-2xl border border-dashed border-agent-border p-3"
      aria-label="Draft reply"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const result = await sendDraftAction(conversationId, messageId, text);
          if (result.error) setError(result.error);
        });
      }}
    >
      <AutoGrowTextarea className="input" minRows={2} maxRows={10} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} aria-label="Edit draft" />
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <div className="flex items-center gap-2">
        <button className="btn-primary" disabled={pending || !text.trim()}>{pending ? "Sending…" : "Send as me"}</button>
        <span className="text-xs text-muted">Nothing is sent until you tap this.</span>
      </div>
    </form>
  );
}
