"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { markReadAction } from "@/app/(app)/actions";

/**
 * Marks the open conversation as read once it is on screen, and again whenever
 * a new message arrives while it is open; then refreshes so the unread badges
 * (chat list and Chats tab) update.
 */
export function MarkRead({ conversationId, latestMessageId }: { conversationId: string; latestMessageId: string | null }) {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    markReadAction(conversationId).then(() => {
      if (!cancelled) router.refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId, latestMessageId, router]);
  return null;
}
