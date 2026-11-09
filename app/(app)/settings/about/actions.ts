"use server";

import { revalidatePath } from "next/cache";
import { requireAgent } from "@/lib/auth";
import { saveFact } from "@/lib/profile/save";

type Out = { error?: string };

async function requirePerson() {
  const { agent } = await requireAgent();
  if (agent.type !== "personal") throw new Error("Not a personal account");
  return agent;
}

/** Save one topic (empty removes it). */
export async function saveTopicAction(input: { category: string; label?: string; value: string; share: boolean }): Promise<Out> {
  const agent = await requirePerson();
  if (input.category === "away") return { error: "Use “Away until” for time away." };
  const result = await saveFact(agent.id, { category: String(input.category), label: input.label, value: String(input.value ?? ""), share: Boolean(input.share) });
  revalidatePath("/settings/about");
  return result.ok ? {} : { error: result.error };
}

/** "Away until 20 Dec": part of availability, forgotten by itself after that day. */
export async function saveAwayAction(input: { until: string; note: string; share: boolean }): Promise<Out> {
  const agent = await requirePerson();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(input.until) ? input.until : "";
  if (!day) {
    await saveFact(agent.id, { category: "away", value: "", share: false });
    revalidatePath("/settings/about");
    return {};
  }
  const end = new Date(`${day}T23:59:59Z`);
  const label = end.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const value = `Away until ${label}${input.note.trim() ? ` (${input.note.trim().slice(0, 200)})` : ""}: not available for plans before then.`;
  const result = await saveFact(agent.id, { category: "away", value, share: Boolean(input.share), expiresAt: end.toISOString() });
  revalidatePath("/settings/about");
  return result.ok ? {} : { error: result.error };
}
