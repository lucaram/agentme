"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendMessage } from "../../actions";
import { appealAction } from "../../social-actions";
import { setReply, useReply } from "@/lib/client/reply";
import { summonsAgent } from "@/lib/agents/commands";

const MAX_HEIGHT = 200; // about 8 lines

export function Composer({
  conversationId,
  threadId,
  placeholder,
  thinkingLabel,
  examples,
  examplesHint,
  collapseExamples = false,
  nearMe = false,
}: {
  /** My Agent: a 📍 button to use where you are right now for one message (weather, "near me"). */
  nearMe?: boolean;
  conversationId: string;
  /** My Agent: the request thread this box belongs to ("new" starts one, then opens it). */
  threadId?: string;
  placeholder: string;
  thinkingLabel?: string;
  /** 💡 Ideas: clicking one fills the box (to adjust before sending), or opens a page (href). */
  examples?: { label: string; text?: string; href?: string }[];
  /** A line shown with the ideas (e.g. "Only you see @agent and its answer."). */
  examplesHint?: string;
  /** Regular users: the chips stay behind a small "💡 Ideas" button. */
  collapseExamples?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [summoned, setSummoned] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();
  const [showExamples, setShowExamples] = useState(!collapseExamples);
  /** Community autopilot: "This might break …" before posting; the author decides. */
  const [nudge, setNudge] = useState<{ rule: string; message: string; text: string } | null>(null);
  /** Not posted by the community's agent: the author can appeal (once). */
  const [appeal, setAppeal] = useState<{ id: string; sent: boolean } | null>(null);
  /** ↩ Reply: the message this one will quote (set from a message's ↩). */
  const replying = useReply(conversationId);
  /** 📍 Near me now: your position, attached to the next message only (never saved). */
  const [here, setHere] = useState<{ lat: number; lon: number } | null>(null);
  const [locating, setLocating] = useState(false);

  function toggleHere() {
    if (here) return setHere(null);
    if (!("geolocation" in navigator)) return setError("This browser can't share your location.");
    setError(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        // About a kilometre is plenty to find your town; the exact spot isn't sent.
        setHere({ lat: Math.round(p.coords.latitude * 100) / 100, lon: Math.round(p.coords.longitude * 100) / 100 });
        ref.current?.focus();
      },
      (e) => {
        setLocating(false);
        setError(e.code === e.PERMISSION_DENIED ? "Location is turned off for this site. Allow it in your browser, or name the place in your message." : "Couldn't find where you are. Name the place in your message instead.");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }

  /** Grow with the text (like ChatGPT/Claude), up to about 8 lines; then scroll. */
  function fit() {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
  }

  function submit(confirmed = false) {
    const text = (confirmed ? nudge?.text : ref.current?.value)?.trim();
    if (!text || pending) return;
    setNudge(null);
    setAppeal(null);
    ref.current!.value = "";
    fit();
    setError(null);
    setSummoned(summonsAgent(text));
    startTransition(async () => {
      const result = await sendMessage(conversationId, text, threadId, { confirmed, replyTo: replying?.id ?? null, here });
      // Your location was for this one message.
      if (!result?.error) setHere(null);
      // Sent (or handed to the agent): the quote is done. Kept when it comes back (nudge or error).
      if (!result?.nudge && !result?.error) setReply(null);
      if (result?.nudge) {
        // Not posted yet: the text comes back, with Edit / Post anyway.
        setNudge({ ...result.nudge, text });
        if (ref.current) {
          ref.current.value = text;
          fit();
        }
        return;
      }
      // A new request got its own thread: open it.
      if (result?.threadId && result.threadId !== threadId) router.push(`/chats/${conversationId}?t=${result.threadId}`);
      if (result?.error) {
        setError(result.error);
        if (result.appealId) setAppeal({ id: result.appealId, sent: false });
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
                if (ex.href) return router.push(ex.href);
                if (!ref.current || !ex.text) return;
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
      {examples && showExamples && examplesHint && <p className="-mt-1 mb-2 text-[11px] text-muted">{examplesHint}</p>}
      {pending && (thinkingLabel || summoned) && (
        <p className="mb-1 text-xs text-muted" aria-live="polite">{thinkingLabel ?? "Your agent is thinking… (only you will see the answer)"}</p>
      )}
      {nudge && (
        <div className="mb-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm" role="alert" data-testid="post-nudge">
          <p>⚠️ {nudge.message}</p>
          <p className="mt-0.5 text-xs text-muted">Only you can see this. You decide.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn-ghost py-1" onClick={() => { setNudge(null); ref.current?.focus(); }}>Edit</button>
            <button type="button" className="btn-primary py-1" disabled={pending} onClick={() => submit(true)}>Post anyway</button>
          </div>
        </div>
      )}
      {here && (
        <p className="mb-1 text-xs text-muted" data-testid="near-me">
          📍 Using where you are now, for this message only. Only the town is used; your position isn&apos;t saved.{" "}
          <button type="button" className="font-medium text-accent hover:underline" onClick={() => setHere(null)}>
            Remove
          </button>
        </p>
      )}
      {error && <p className="mb-1 text-xs text-danger" role="alert">{error}</p>}
      {appeal && (
        <p className="mb-1 text-xs text-muted" data-testid="appeal">
          {appeal.sent ? (
            "Appeal sent. A moderator can post it; if nobody answers within 3 days and you have a good history here, it's posted automatically."
          ) : (
            <>
              Think this is a mistake?{" "}
              <button
                type="button"
                className="font-medium text-accent hover:underline"
                onClick={() =>
                  startTransition(async () => {
                    const r = await appealAction(appeal.id);
                    if (r.error) setError(r.error);
                    else setAppeal({ ...appeal, sent: true });
                  })
                }
              >
                Appeal
              </button>
            </>
          )}
        </p>
      )}
      {/* One rounded box with the send button inside, like ChatGPT / Claude / Gemini. */}
      {replying && (
        <div className="mb-1.5 flex items-center gap-2 rounded-2xl border-l-4 border-accent bg-surface px-3 py-1.5 text-xs" data-testid="replying-to">
          <span className="min-w-0 flex-1">
            <span className="font-semibold">↩ Replying to {replying.author}</span>
            <span className="block truncate text-muted">{replying.snippet}</span>
          </span>
          <button type="button" className="rounded-full px-2 py-1 text-muted hover:bg-accent-soft" aria-label="Cancel reply" onClick={() => setReply(null)}>
            ✕
          </button>
        </div>
      )}
      <form
        className="flex items-end gap-2 rounded-3xl border border-border bg-surface py-2 pl-4 pr-2 shadow-sm transition-colors focus-within:border-accent"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={ref}
          aria-label="Message"
          rows={1}
          className="thin-scrollbar block min-h-10 flex-1 resize-none overflow-hidden bg-transparent py-2 text-[15px] leading-6 outline-none placeholder:text-muted"
          placeholder={placeholder}
          onInput={fit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
            // Esc cancels a reply.
            if (e.key === "Escape" && replying) setReply(null);
          }}
        />
        {nearMe && (
          <button
            type="button"
            aria-label="Near me now"
            aria-pressed={Boolean(here)}
            title={here ? "Using where you are now for this message (tap to remove)" : "Use where I am now for this message"}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg transition hover:bg-accent-soft disabled:opacity-50 ${here ? "bg-accent-soft ring-1 ring-accent" : ""}`}
            disabled={pending || locating}
            onClick={toggleHere}
          >
            {locating ? "…" : "📍"}
          </button>
        )}
        <button
          aria-label="Send"
          title="Send (Enter) · New line: Shift+Enter"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-lg font-semibold text-white transition hover:opacity-90 disabled:opacity-50 dark:text-black"
          disabled={pending}
        >
          {pending ? "…" : "↑"}
        </button>
      </form>
    </div>
  );
}
