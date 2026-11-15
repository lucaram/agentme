"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getAgentForUser } from "@/lib/data/agents";
import { realPerson, signInAs, forgetPerson } from "@/lib/identities";

/** Restrictions deliberately do not remove a person's ability to challenge the decision. */
export async function submitAccountAppeal(id: string, reason: string): Promise<{ error?: string }> {
  const user = await getUser(); if (!user) return { error: "Sign in to appeal this decision." };
  const value = z.object({ id: z.uuid(), reason: z.string().trim().min(1).max(2000) }).safeParse({ id, reason }); if (!value.success) return { error: "Explain your appeal in up to 2,000 characters." };
  const { error } = await (await createClient()).rpc("submit_account_appeal", { p_sanction: id, p_reason: value.data.reason });
  if (error) return { error: "Couldn't submit this appeal. Check that the decision belongs to your account." };
  revalidatePath("/account-status"); revalidatePath("/moderation", "layout"); revalidatePath("/chats", "layout"); return {};
}

export async function returnToPersonalAccount(): Promise<void> {
  const user = await getUser(); if (!user) redirect("/login");
  const agent = await getAgentForUser(user.id); if (!agent || agent.type !== "business") redirect("/account-status");
  const person = await realPerson(user, agent);
  // This exception permits only the manager's own personal identity, for notice/appeal access.
  if (person && person !== user.id && await signInAs(person)) await forgetPerson();
  redirect("/account-status");
}
