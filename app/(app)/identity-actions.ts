"use server";

import { redirect } from "next/navigation";
import { requireAgent } from "@/lib/auth";
import { createBusinessFor, realPerson, switchTo } from "@/lib/identities";
import { describeRetry, hit } from "@/lib/limits";
import { adminClient } from "@/lib/supabase/admin";
import { allowLocal } from "@/lib/business/fetch";
import { normaliseSite } from "@/lib/business/site";
import { attachWebsite } from "@/lib/business/site-setup";

/** Header switcher: act as your personal identity or one of your businesses. */
export async function switchIdentityAction(targetAgentId: string): Promise<{ error?: string }> {
  const { user, agent } = await requireAgent();
  const result = await switchTo(user, agent, targetAgentId);
  if (!result.ok) return { error: result.error };
  redirect("/chats");
}

export type AddBusinessState = { error?: string } | undefined;

/** "Add a business": a separate identity you manage, then switch into it. */
export async function addBusinessAction(_prev: AddBusinessState, form: FormData): Promise<AddBusinessState> {
  const { user, agent } = await requireAgent();
  if (user.isAnonymous || agent.guest) return { error: "Save your account first (Settings), then add your business." };
  const person = await realPerson(user, agent);
  if (!person) return { error: "Please log in again." };
  // "Have a website?": checked before anything is created.
  const website = String(form.get("website") ?? "").trim();
  if (website) {
    const site = normaliseSite(website, { allowLocal: allowLocal() });
    if (!site.ok) return { error: `Website: ${site.error}` };
  }
  const limit = await hit("businessesPerPerson", person);
  if (!limit.allowed) return { error: `You've added several businesses recently. Try again in ${describeRetry(limit.retryAfterSeconds)}.` };
  const created = await createBusinessFor(person, {
    name: String(form.get("name") ?? ""),
    handle: String(form.get("handle") ?? ""),
    avatar: String(form.get("avatar") ?? ""),
    about: String(form.get("about") ?? ""),
  });
  if (!created.ok) return { error: created.error };
  // The website is read in the background; the person reviews it as the business.
  let reading = false;
  if (website) {
    const { data } = await adminClient().auth.admin.getUserById(person);
    reading = (await attachWebsite(created.agentId, website, { email: data.user?.email ?? null, emailConfirmed: Boolean(data.user?.email_confirmed_at) })).ok;
  }
  const switched = await switchTo(user, agent, created.agentId);
  if (!switched.ok) redirect("/chats");
  redirect(reading ? "/business/setup" : "/business?welcome=1");
}
