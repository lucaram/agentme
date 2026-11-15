"use server";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { ReactionKey, ReactionSummary } from "@/lib/chat/reactions";

export async function setMessageReaction(messageId: string, reaction: ReactionKey | null): Promise<{ error?: string; summary?: ReactionSummary }> {
  if (!await getUser()) return { error: "Sign in first." };
  const input = z.object({ messageId: z.uuid(), reaction: ReactionKey.nullable() }).safeParse({ messageId, reaction });
  if (!input.success) return { error: "Invalid reaction." };
  const { data, error } = await (await createClient()).rpc("set_message_reaction", { p_message: messageId, p_reaction: reaction });
  if (error) return { error: "Couldn't update your reaction. The chat or message may no longer be available. Try again shortly." };
  const parsed = ReactionSummary.array().safeParse(data);
  if (!parsed.success) return { error: "Couldn't update your reaction. Try again." };
  return { summary: parsed.data[0] ?? { message_id: messageId, counts: {}, mine: null } };
}
