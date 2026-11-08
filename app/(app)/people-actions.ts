"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAgent } from "@/lib/auth";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getAgentByHandle } from "@/lib/data/agents";
import { normaliseCountryCode, normaliseEmail } from "@/lib/people/normalise";
import { clearAddressBook, confirmPhone, registerAccountEmail, removePhone, startPhoneVerification, syncAddressBook } from "@/lib/people/matching";
import { verifyLiveConnectToken } from "@/lib/people/crypto";
import { connectPeople, openDmWithNote } from "@/lib/people/connect";
import { answerIntroduction, createIntroduction } from "@/lib/people/introductions";
import { getOrCreateInvite, revokeInvites } from "@/lib/plans/invites";

type Out = { error?: string };

// ------------------------------------------------------------- people you know

/** Compare an address book (emails/phones only, read on the device) and forget it. */
export async function syncContactsAction(entries: string[], countryCode: string | null, source: "phone" | "typed"): Promise<Out & { checked?: number }> {
  const { user, agent } = await requireAgent();
  if (!Array.isArray(entries)) return { error: "Nothing to check." };
  // Syncing also makes you findable by your own verified email (mutual matches only).
  await registerAccountEmail(agent.id, user);
  const result = await syncAddressBook(
    agent,
    entries.filter((e) => typeof e === "string"),
    normaliseCountryCode(countryCode),
    source === "phone" ? "phone" : "typed",
  );
  revalidatePath("/discover");
  return result.ok ? { checked: result.checked } : { error: result.error };
}

export async function clearContactsAction(): Promise<Out> {
  const { agent } = await requireAgent();
  await clearAddressBook(agent.id);
  revalidatePath("/discover");
  return {};
}

export async function sendPhoneCodeAction(phone: string): Promise<Out & { devCode?: string }> {
  const { agent } = await requireAgent();
  const result = await startPhoneVerification(agent, String(phone ?? ""));
  return result.ok ? { devCode: result.devCode } : { error: result.error };
}

export async function confirmPhoneAction(phone: string, code: string): Promise<Out> {
  const { agent } = await requireAgent();
  const result = await confirmPhone(agent, String(phone ?? ""), String(code ?? ""));
  revalidatePath("/discover");
  revalidatePath("/settings");
  return result.ok ? {} : { error: result.error };
}

export async function removePhoneAction(): Promise<Out> {
  const { agent } = await requireAgent();
  await removePhone(agent.id);
  revalidatePath("/discover");
  revalidatePath("/settings");
  return {};
}

// ------------------------------------------------------------- introductions

export async function introduceAction(a: string, b: string, note: string): Promise<Out & { done?: boolean }> {
  const { agent } = await requireAgent();
  const result = await createIntroduction(agent, String(a ?? ""), String(b ?? ""), typeof note === "string" ? note : null);
  return result.ok ? { done: true } : { error: result.error };
}

export async function answerIntroductionAction(itemId: string, accept: boolean): Promise<Out> {
  const { user } = await requireAgent();
  if (!z.uuid().safeParse(itemId).success) return { error: "Not found." };
  const result = await answerIntroduction(itemId, user.id, Boolean(accept));
  revalidatePath("/inbox");
  revalidatePath("/contacts");
  if (!result.ok) return { error: result.error };
  if (result.chatId) redirect(`/chats/${result.chatId}`);
  return {};
}

// ------------------------------------------------------------- personal link / QR

/**
 * Scanned a live QR code (shown on the other person's screen a moment ago):
 * connect straight away and open the chat. Without a valid live code it's a
 * normal contact request.
 */
export async function connectNowAction(handle: string, token: string): Promise<Out> {
  const { agent } = await requireAgent();
  const other = await getAgentByHandle(String(handle ?? ""));
  if (!other || other.id === agent.id) return { error: "Not found." };
  if (!verifyLiveConnectToken(other.id, String(token ?? ""))) return { error: "This code has expired. Ask them to show it again, or send a request." };
  if (!(await connectPeople(other, agent))) return { error: "You can't connect with this person." };
  const chatId = await openDmWithNote(agent, other, "📷 You connected in person. Say hi!");
  revalidatePath("/contacts");
  redirect(`/chats/${chatId}`);
}

// ------------------------------------------------------------- plan invite links

export async function inviteLinkAction(taskId: string): Promise<Out & { url?: string }> {
  const { user } = await requireAgent();
  if (!z.uuid().safeParse(taskId).success) return { error: "Not found." };
  const result = await getOrCreateInvite(taskId, user.id);
  return result.ok ? { url: result.url } : { error: result.error };
}

export async function revokeInviteAction(taskId: string): Promise<Out> {
  const { user } = await requireAgent();
  if (!z.uuid().safeParse(taskId).success) return { error: "Not found." };
  const result = await revokeInvites(taskId, user.id);
  return result.ok ? {} : { error: result.error };
}

// ------------------------------------------------------------- guests

const SaveAccount = z.object({
  email: z.string().transform((e) => normaliseEmail(e) ?? "").refine(Boolean, "Enter a valid email."),
  password: z.string().min(8, "Use at least 8 characters."),
});

/** A guest keeps their account: adds an email and password (their plans, chats and contacts stay). */
export async function saveGuestAccountAction(_prev: Out | undefined, form: FormData): Promise<Out> {
  const { user, agent } = await requireAgent();
  if (!agent.guest) return { error: "Your account is already saved." };
  const parsed = SaveAccount.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  // Supabase Auth applies the project's email-confirmation policy here.
  const { error } = await supabase.auth.updateUser({ email: parsed.data.email });
  if (error) return { error: error.message.includes("already") ? "That email already has an account. Log in with it instead." : error.message };
  const { error: pwError } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (pwError) return { error: "Check your email to confirm it, then come back to set your password." };
  await adminClient().from("agents").update({ guest: false }).eq("id", agent.id).eq("owner_id", user.id);
  revalidatePath("/", "layout");
  redirect("/settings?saved=account");
}
