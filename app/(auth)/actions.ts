"use server";

import { redirect } from "next/navigation";
import { restoreAtLogin } from "@/lib/appearance-server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/next-path";
import { getAgentForUser } from "@/lib/data/agents";
import { registerAccountEmail } from "@/lib/people/matching";
import { forgetPerson } from "@/lib/identities";

export type AuthState = { error?: string } | undefined;

const Credentials = z.object({
  email: z.email("Enter a valid email."),
  password: z.string().min(8, "Use at least 8 characters."),
});

export async function signUp(_prev: AuthState, form: FormData): Promise<AuthState> {
  const parsed = Credentials.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp(parsed.data);
  if (error) return { error: error.message };
  // e.g. back to the invite link or personal link that sent them here.
  const next = safeNext(form.get("next"), "");
  redirect(next ? `/onboarding?next=${encodeURIComponent(next)}` : "/onboarding");
}

export async function signIn(_prev: AuthState, form: FormData): Promise<AuthState> {
  const parsed = Credentials.extend({ password: z.string().min(1, "Enter your password.") }).safeParse({
    email: form.get("email"),
    password: form.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "Wrong email or password." };
  // A fresh login is a fresh person: forget any identity switched into before.
  await forgetPerson();
  // Keep the verified email matchable for "People you know" (only ever mutual).
  const agent = await getAgentForUser(data.user.id);
  if (agent) await registerAccountEmail(agent.id, { email: data.user.email ?? null, emailConfirmed: Boolean(data.user.email_confirmed_at) });
  // Their Personalise choices follow them to this device.
  await restoreAtLogin(data.user.id);
  redirect(safeNext(form.get("next")));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  await forgetPerson();
  redirect("/login");
}
