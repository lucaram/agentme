import { z } from "zod";

export const TOPIC_GROUPS = ["needs", "progress", "recent", "older"] as const;
export type TopicGroup = typeof TOPIC_GROUPS[number];
export type TopicView = TopicGroup | "search";
export const TOPIC_TITLES: Record<TopicGroup, string> = { needs: "Needs you", progress: "In progress", recent: "Recent", older: "History" };
export const Topic = z.object({ id: z.uuid(), kind: z.string(), title: z.string(), last_activity_at: z.string(), task_status: z.string().nullable(), topic_group: z.enum(TOPIC_GROUPS), unread: z.number(), preview: z.string().nullable() });
export type Topic = z.infer<typeof Topic>;
export const TopicPage = z.object({ items: z.array(Topic).max(10), hasMore: z.boolean(), asOf: z.string(), counts: z.object({ needs: z.number(), progress: z.number(), recent: z.number(), older: z.number() }) });
export type TopicPage = z.infer<typeof TopicPage>;
export type TopicSeed = Record<Exclude<TopicGroup, "older">, TopicPage | null>;
export const TOPIC_LABELS: Record<string, string> = { awaiting_approval: "Approve to start", proposal_ready: "Plan ready for approval", running: "Working on it", waiting: "Waiting for answers", accepted: "Plan shared", completed: "Done", cancelled: "Cancelled", rejected: "Not going ahead", failed: "Couldn't finish" };
export function topicLabel(topic: Topic) { return TOPIC_LABELS[topic.task_status ?? ""] ?? (topic.kind === "updates" ? "Notes and requests from others" : null); }
export function topicPageUrl(conversation: string, group: TopicView, query = "", asOf?: string, last?: Topic) {
  const params = new URLSearchParams({ group }); if (query) params.set("q", query); if (asOf) params.set("asOf", asOf);
  if (last) { params.set("before", last.last_activity_at); params.set("item", last.id); }
  return `/api/chats/${conversation}/topics?${params}`;
}
