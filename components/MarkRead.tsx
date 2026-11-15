"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { acknowledgeVisibleMessages } from "@/app/(app)/receipt-actions";
import { READ_EVENT } from "./ChatsBadge";
import { scheduleRefresh } from "@/lib/refresh";
import { watchVisibleMessages } from "@/lib/client/message-visibility";

/**
 * Only individually visible messages in the active tab become read. Page
 * rendering, prefetching and offscreen arrivals never mark a chat read.
 */
export function MarkRead({ conversationId, messageIds, threadId }: { conversationId: string; messageIds: string[]; threadId?: string }) {
  const router = useRouter();
  const key = messageIds.join(",");
  useEffect(() => {
    return watchVisibleMessages(key.split(",").filter(Boolean), "data-seen-message", async (ids) => {
      const accepted = await acknowledgeVisibleMessages(ids);
      if (accepted.length) { window.dispatchEvent(new CustomEvent(READ_EVENT, { detail: { ids: accepted } })); scheduleRefresh(() => router.refresh()); }
      return accepted;
    });
  }, [conversationId, key, threadId, router]);
  return null;
}
