"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { markReadAction } from "@/app/(app)/actions";

/**
 * Marks the open conversation as read once it is on screen, and again whenever
 * a new message arrives while it is open; then refreshes so the unread badges
 * update. The refresh deliberately also runs if the user has already moved to
 * another page: the header (layout) isn't re-rendered on navigation, so this is
 * what keeps the Chats tab total correct.
 */
export function MarkRead({ conversationId, latestMessageId }: { conversationId: string; latestMessageId: string | null }) {
  const router = useRouter();
  useEffect(() => {
    markReadAction(conversationId).then(() => router.refresh());
  }, [conversationId, latestMessageId, router]);
  return null;
}
