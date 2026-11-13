"use client";

import { useState } from "react";
import { replyTo } from "@/lib/client/reply";
import type { ReplyTarget } from "@/lib/social/quote";
import { ForwardPicker } from "./Forward";

const ICON = "hover-only rounded-full px-1.5 py-0.5 text-sm text-muted hover:bg-accent-soft hover:text-foreground";

/** ↩ next to a message (desktop, on hover). On phones these live in ⋯. */
export function ReplyButton({ conversationId, target }: { conversationId: string; target: ReplyTarget }) {
  return (
    <button type="button" className={ICON} aria-label="Reply" title="Reply" onClick={() => replyTo(conversationId, target)}>
      ↩
    </button>
  );
}

/** ↪ next to a message (desktop, on hover): forward it yourself, labelled. */
export function ForwardIcon({ messageId }: { messageId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={ICON} aria-label="Forward" title="Forward" onClick={() => setOpen(true)}>
        ↪
      </button>
      {open && <ForwardPicker messageId={messageId} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The quote at the top of a reply: who and what; tap to jump to the original (it flashes). */
export function QuoteBlock({ targetId, author, snippet, ai, state }: { targetId: string; author: string; snippet: string; ai: boolean; state: "ok" | "removed" | "missing" }) {
  const jump = () => {
    const el = document.getElementById(`m-${targetId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("reply-flash");
    window.setTimeout(() => el.classList.remove("reply-flash"), 1600);
  };
  return (
    <button
      type="button"
      onClick={jump}
      disabled={state !== "ok"}
      className="mb-1 block w-full rounded-lg border-l-4 border-accent bg-black/5 px-2 py-1 text-left text-xs dark:bg-white/10"
      data-testid="quote"
      aria-label={state === "ok" ? `Replying to ${author}: ${snippet}. Show the original` : undefined}
    >
      {state === "removed" ? (
        <span className="italic opacity-80">Original message removed</span>
      ) : state === "missing" ? (
        <span className="italic opacity-80">Original message not available</span>
      ) : (
        <>
          <span className="flex items-center gap-1 font-semibold">
            {author}
            {ai && <span className="rounded bg-agent-border px-1 text-[9px] font-semibold uppercase">AI</span>}
          </span>
          <span className="line-clamp-2 opacity-80">{snippet}</span>
        </>
      )}
    </button>
  );
}
