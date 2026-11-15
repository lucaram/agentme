"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ReceiptSchema } from "@/lib/chat/receipts";

export async function acknowledgeVisibleMessages(ids: string[]): Promise<string[]> {
  await requireUser();
  const parsed = z.array(z.uuid()).max(100).safeParse(ids); if (!parsed.success) return [];
  const { data, error } = await (await createClient()).rpc("acknowledge_messages", { p_ids: parsed.data, p_seen: true });
  if (error) return [];
  if (data?.length) revalidatePath("/chats", "layout");
  return data ?? [];
}

export async function acknowledgeBusinessQuestion(id: string): Promise<string[]> {
  await requireUser(); if (!z.uuid().safeParse(id).success) return [];
  const { data, error } = await (await createClient()).rpc("acknowledge_business_question", { p_inbox: id });
  return !error && data ? [id] : [];
}

export async function receiptDetails(id: string) {
  await requireUser(); if (!z.uuid().safeParse(id).success) return null;
  const { data, error } = await (await createClient()).rpc("get_message_receipts", { p_ids: [id], p_details: true });
  if (error) return null;
  return ReceiptSchema.array().safeParse(data).data?.[0] ?? null;
}
