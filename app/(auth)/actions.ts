"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error?: string } | undefined;

const Credentials = z.object({
  email: z.email("Enter a valid email."),
  password: z.string().min(8, "Use at least 8 characters."),
});

function safeNext(next: FormDataEntryValue | null) {
  const value = typeof next === "string" ? next : "";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/chats";
}

export async function signUp(_prev: AuthState, form: FormData): Promise<AuthState> {
  const parsed = Credentials.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp(parsed.data);
  if (error) return { error: error.message };
  redirect("/onboarding");
}

export async function signIn(_prev: AuthState, form: FormData): Promise<AuthState> {
  const parsed = Credentials.extend({ password: z.string().min(1, "Enter your password.") }).safeParse({
    email: form.get("email"),
    password: form.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "Wrong email or password." };
  redirect(safeNext(form.get("next")));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
