"use client";

import { replyTo } from "@/lib/client/reply";
import type { ReplyTarget } from "@/lib/social/quote";

/** The small ↩ that appears next to a message on hover (desktop); on phones, use ⋯ → ↩ Reply. */
export function ReplyButton({ conversationId, target }: { conversationId: string; target: ReplyTarget }) {
  return (
    <button
      type="button"
      className="self-center rounded-full px-1.5 text-sm text-muted opacity-0 transition hover:bg-accent-soft hover:text-foreground focus:opacity-100 group-hover:opacity-100"
      aria-label="Reply"
      title="Reply"
      onClick={() => replyTo(conversationId, target)}
    >
      ↩
    </button>
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
