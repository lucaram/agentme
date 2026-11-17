"use client";

import { useCurrentNotifications } from "./NotificationProvider";

/** Shares the header's live snapshot, including views recorded on another device. */
export function ConversationNotificationBadge({ conversationId, initial, muted = false }: { conversationId: string; initial: number; muted?: boolean }) {
  const counts = useCurrentNotifications();
  const count = counts ? counts.unread.find((row) => row.conversation_id === conversationId)?.unread ?? 0 : initial;
  return count > 0 ? <span className={`min-w-5 rounded-full px-1.5 text-center text-xs font-semibold leading-5 ${muted ? "bg-border text-muted" : "bg-accent text-white dark:text-black"}`} data-testid="unread-badge" aria-label={`${count} unread`}>{count > 99 ? "99+" : count}</span> : null;
}

export function AgentNotificationSubtitle({ initial, fallback }: { initial: number; fallback: string }) {
  const attention = useCurrentNotifications()?.attention ?? initial;
  return <span className={`block truncate text-sm ${attention ? "text-foreground" : "text-muted"}`} data-testid="my-agent-subtitle">{attention ? `🔔 ${attention} ${attention === 1 ? "thing needs" : "things need"} your answer` : fallback}</span>;
}
