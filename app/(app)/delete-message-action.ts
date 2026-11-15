"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** The database checks the authenticated sender, visibility and current membership. */
export async function deleteOwnMessageAction(messageId: string): Promise<{ error?: string }> {
  await requireAgent();
  if (!z.uuid().safeParse(messageId).success) return { error: "Message not found." };
  const { error } = await (await createClient()).rpc("delete_own_message", { p_message: messageId });
  if (error) return { error: "Couldn't delete this message. You can only delete your own messages in this chat." };
  revalidatePath("/chats", "layout");
  return {};
}
