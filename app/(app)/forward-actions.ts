"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAgent } from "@/lib/auth";
import { describeRetry, hit } from "@/lib/limits";
import { forwardLabel, nextForward } from "@/lib/social/forward";
import { forwardable, forwardMessage, forwardPlacesFor, type ForwardPlace, type ForwardResult } from "@/lib/social/forward-server";

const Id = z.uuid();

/** Opening ↪ Forward: where you can forward this message, how many at once, and the label it will carry. */
export async function forwardPlacesAction(messageId: string): Promise<{ error: string } | { places: ForwardPlace[]; limit: number; label: string }> {
  const { user, agent } = await requireAgent();
  if (!Id.safeParse(messageId).success) return { error: "Not found." };
  const check = await forwardable(user.id, messageId);
  if (!check.ok) return { error: check.error };
  return { places: await forwardPlacesFor(user.id, agent), limit: check.limit, label: forwardLabel(nextForward(check.message)) };
}

/** ↪ Forward to the chosen chats: you do it (never your agent); each chat's usual rules apply. */
export async function forwardAction(messageId: string, keys: string[]): Promise<{ error?: string; results?: ForwardResult[] }> {
  const { user, agent } = await requireAgent();
  if (!Id.safeParse(messageId).success) return { error: "Not found." };
  const parsed = z.array(z.string().max(80)).max(10).safeParse(keys);
  if (!parsed.success) return { error: "Choose up to 5 chats." };
  const limit = await hit("forwardsPerUser", user.id);
  if (!limit.allowed) return { error: `You've forwarded a lot recently. Try again in ${describeRetry(limit.retryAfterSeconds)}.` };
  const result = await forwardMessage(user.id, agent, messageId, parsed.data);
  revalidatePath("/chats", "layout");
  return "error" in result ? { error: result.error } : { results: result.results };
}
