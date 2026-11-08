"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { markReadAction } from "@/app/(app)/actions";
import { READ_EVENT } from "./ChatsBadge";
import { scheduleRefresh } from "@/lib/refresh";

/**
 * Marks the open conversation as read once it is on screen, and again whenever
 * a new message arrives while it is open; then refreshes so the unread badges
 * update (the Chats tab total also reloads itself on READ_EVENT).
 */
export function MarkRead({ conversationId, latestMessageId }: { conversationId: string; latestMessageId: string | null }) {
  const router = useRouter();
  useEffect(() => {
    markReadAction(conversationId).then(() => {
      window.dispatchEvent(new Event(READ_EVENT)); // the Chats tab total reloads itself
      scheduleRefresh(() => router.refresh()); // shared with live updates: one render, not several
    });
  }, [conversationId, latestMessageId, router]);
  return null;
}
