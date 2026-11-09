"use client";

import { useSyncExternalStore } from "react";
import type { ReplyTarget } from "@/lib/social/quote";

/**
 * ↩ Reply: which message the message box is replying to. Shared between the
 * "↩ Reply" buttons on messages and the message box (one chat at a time).
 */
type Current = (ReplyTarget & { conversationId: string }) | null;
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

/** The message being replied to in this chat (null otherwise). */
export function useReply(conversationId: string): ReplyTarget | null {
  const value = useSyncExternalStore(subscribe, () => current, () => null);
  return value && value.conversationId === conversationId ? value : null;
}

/** Start replying, and put the cursor in the message box. */
export function replyTo(conversationId: string, target: ReplyTarget) {
  setReply({ ...target, conversationId });
  document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.focus();
}
