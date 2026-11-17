"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { withBusinessActor } from "@/lib/business/actor-context";
import { describeRetry, hit } from "@/lib/limits";
import { forwardLabel, nextForward } from "@/lib/social/forward";
import { forwardable, forwardMessage, forwardPlacesFor, type ForwardResult } from "@/lib/social/forward-server";

const Id = z.uuid();

/** Opening ↪ Forward: where you can forward this message, how many at once, and the label it will carry. */
export async function forwardPlacesAction(messageId: string) {
  const { user, agent } = await requireAgent();
  if (!Id.safeParse(messageId).success) return { error: "Not found." };
  if (!(await (await createClient()).rpc("can_read_chat_message", { p_message: messageId, p_user: user.id })).data) return { error: "Not found." };
  const check = await forwardable(user.id, messageId);
  if (!check.ok) return { error: check.error };
  return { places: await forwardPlacesFor(user.id, agent), limit: check.limit, label: forwardLabel(nextForward(check.message)), preview: check.preview, origin: nextForward(check.message), revision: check.revision };
}

/** ↪ Forward to the chosen chats: you do it (never your agent); each chat's usual rules apply. */
export async function forwardAction(messageId: string, keys: string[], revision: string): Promise<{ error?: string; results?: ForwardResult[] }> {
  const { user, agent } = await requireAgent();
  if (!Id.safeParse(messageId).success) return { error: "Not found." };
  if (!z.string().regex(/^[a-f0-9]{64}$/).safeParse(revision).success) return { error: "Open Forward to review the message first." };
  if (!(await (await createClient()).rpc("can_read_chat_message", { p_message: messageId, p_user: user.id })).data) return { error: "Not found." };
  const parsed = z.array(z.string().max(80)).max(10).safeParse(keys);
  if (!parsed.success) return { error: "Choose up to 5 chats." };
  const limit = await hit("forwardsPerUser", user.id);
  if (!limit.allowed) return { error: `You've forwarded a lot recently. Try again in ${describeRetry(limit.retryAfterSeconds)}.` };
  const result = await withBusinessActor(user, agent, () => forwardMessage(user.id, agent, messageId, parsed.data, revision));
  revalidatePath("/chats", "layout");
  return "error" in result ? { error: result.error } : { results: result.results };
}
