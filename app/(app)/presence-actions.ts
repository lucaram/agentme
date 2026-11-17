"use server";

import { z } from "zod";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PresenceMode } from "@/lib/presence/types";

export async function setPresenceMode(mode: string, minutes: number | null): Promise<{ error?: string }> {
  await requireAgent();
  const parsed = z.object({ mode: PresenceMode, minutes: z.union([z.literal(60), z.literal(240), z.null()]) }).safeParse({ mode, minutes });
  if (!parsed.success) return { error: "Choose a valid status and duration." };
  const { error } = await (await createClient()).rpc("set_presence_mode", { p_mode: parsed.data.mode, p_minutes: parsed.data.minutes });
  return error ? { error: "Couldn't update your status. Please try again." } : {};
}

export async function setWorkParticipation(available: boolean): Promise<{ error?: string }> {
  await requireAgent(); if (typeof available !== "boolean") return { error: "Choose your work availability." };
  const { error } = await (await createClient()).rpc("set_work_participation", { p_available: available });
  return error ? { error: "Couldn't update your work availability." } : {};
}
