"use client";
import { AccountNotificationBadge, useCurrentNotifications } from "@/components/notifications/NotificationProvider";
type Tab = "contacts" | "groups" | "communities";

export function TabBadge({ tab, initial }: { tab: Tab; initial: number }) {
  const notifications = useCurrentNotifications();
  return <AccountNotificationBadge count={notifications?.[tab] ?? initial} testId={`${tab}-badge`} label="waiting" />;
}
