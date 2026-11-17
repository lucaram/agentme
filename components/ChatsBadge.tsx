"use client";
import { AccountNotificationBadge, useCurrentNotifications } from "@/components/notifications/NotificationProvider";
export { READ_EVENT } from "@/lib/notifications/types";

export function ChatsBadge({ initial }: { initial: number }) {
  const notifications = useCurrentNotifications();
  return <AccountNotificationBadge count={notifications?.chats ?? initial} testId="chats-badge" label="unread or awaiting action in Chats" />;
}
