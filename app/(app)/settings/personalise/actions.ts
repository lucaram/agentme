"use server";

import { requireAgent } from "@/lib/auth";
import { parseAppearance } from "@/lib/appearance";
import { rememberOnDevice, saveForPerson } from "@/lib/appearance-server";
import { realPerson } from "@/lib/identities";

/** Saves the look on this device (cookie) and on the person's account (follows them everywhere). */
export async function saveAppearanceAction(input: unknown): Promise<{ error?: string }> {
  const { user, agent } = await requireAgent();
  const look = parseAppearance(input);
  await rememberOnDevice(look);
  const person = await realPerson(user, agent);
  if (person) await saveForPerson(person, look);
  return {};
}
