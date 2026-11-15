import { z } from "zod";

export const REACTIONS = [
  { key: "heart", emoji: "❤️", label: "Heart" }, { key: "up", emoji: "👍", label: "Thumbs up" },
  { key: "down", emoji: "👎", label: "Thumbs down" }, { key: "happy", emoji: "🙂", label: "Happy" },
  { key: "angry", emoji: "😠", label: "Angry" }, { key: "sad", emoji: "😔", label: "Sad" },
  { key: "laugh", emoji: "😂", label: "Laugh" }, { key: "cry", emoji: "😭", label: "Cry" },
] as const;
export const ReactionKey = z.enum(["heart", "up", "down", "happy", "angry", "sad", "laugh", "cry"]);
export type ReactionKey = z.infer<typeof ReactionKey>;
export const ReactionSummary = z.object({ message_id: z.uuid(), counts: z.partialRecord(ReactionKey, z.number().int().nonnegative()), mine: ReactionKey.nullable() });
export type ReactionSummary = z.infer<typeof ReactionSummary>;
export const ReactionDetails = z.object({ items: z.array(z.object({ user_id: z.uuid(), reaction: ReactionKey, reacted_at: z.string(), name: z.string().nullable(), handle: z.string().nullable(), avatar: z.string().nullable() })), hasMore: z.boolean() });
export type ReactionDetails = z.infer<typeof ReactionDetails>;

export function withReaction(summary: ReactionSummary, reaction: ReactionKey | null): ReactionSummary {
  const counts = { ...summary.counts };
  if (summary.mine) counts[summary.mine] = Math.max(0, (counts[summary.mine] ?? 0) - 1);
  if (reaction) counts[reaction] = (counts[reaction] ?? 0) + 1;
  return { ...summary, counts, mine: reaction };
}
