"use client";

import { useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import type { ReplyTarget } from "@/lib/social/quote";

/**
 * ↩ Reply: which message the message box is replying to. Shared between the
 * "↩ Reply" buttons on messages and the message box (one chat at a time).
 *
 * My Agent keeps every request in one conversation, each in its own thread
 * (?t=<thread>), so a reply belongs to the conversation AND the thread it was
 * chosen in: a quote picked in one request never rides along on a message
 * typed in another request, or on a new one.
 */
type Current = (ReplyTarget & { conversationId: string; thread: string }) | null;
let current: Current = null;
const listeners = new Set<() => void>();

export function setReply(target: Current) {
  current = target;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Is this selection for the chat (and thread) now on screen? Pure (unit-tested). */
export function replyFor(selected: Current, conversationId: string, thread: string): ReplyTarget | null {
  return selected && selected.conversationId === conversationId && selected.thread === thread ? selected : null;
}

/** The message being replied to in this chat and thread (null otherwise). */
export function useReply(conversationId: string): ReplyTarget | null {
  const thread = useSearchParams().get("t") ?? "";
  const value = useSyncExternalStore(subscribe, () => current, () => null);
  return replyFor(value, conversationId, thread);
}

/** Start replying, and put the cursor in the message box. */
export function replyTo(conversationId: string, target: ReplyTarget) {
  const thread = new URLSearchParams(window.location.search).get("t") ?? "";
  setReply({ ...target, conversationId, thread });
  document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.focus();
}
