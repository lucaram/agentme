import { z } from "zod";

export const READ_EVENT = "agentme:read";
export const NOTIFICATION_EVENT = "agentme:notifications";
const Count = z.number().int().nonnegative();
export const NotificationCounts = z.object({ total: Count, chats: Count, contacts: Count, groups: Count, communities: Count, attention: Count,
  unread: z.array(z.object({ conversation_id: z.uuid(), unread: Count, muted: z.boolean() })) });
export type NotificationCounts = z.infer<typeof NotificationCounts>;
export const NotificationAccount = z.object({ agentId: z.uuid(), ownerId: z.uuid(), handle: z.string(), displayName: z.string(), avatar: z.string(), type: z.enum(["personal", "business"]), current: z.boolean(), role: z.enum(["owner", "manager", "staff"]).nullable(), notifications: NotificationCounts });
export const NotificationState = z.object({ actorId: z.uuid(), currentId: z.uuid(), asOf: z.string(), accounts: z.array(NotificationAccount) });
export type NotificationState = z.infer<typeof NotificationState>;
export const EMPTY_COUNTS: NotificationCounts = { total: 0, chats: 0, contacts: 0, groups: 0, communities: 0, attention: 0, unread: [] };
