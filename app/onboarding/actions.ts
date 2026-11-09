"use server";

import { MAX_BUSINESS_NAME, MIN_NAME, SIGNUP_LIMITS, maxNameFor } from "@/lib/social/limits";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { adminClient } from "@/lib/supabase/admin";
import { getAgentForUser } from "@/lib/data/agents";
import { getOrCreateMyAgentConversation, postMessage } from "@/lib/data/chat";
import { validateHandle } from "@/lib/policy/handles";
import { asJson } from "@/lib/data/json";
import { avatarsFor } from "@/lib/avatars";
import { normaliseSite } from "@/lib/business/site";
import { allowLocal } from "@/lib/business/fetch";
import { attachWebsite } from "@/lib/business/site-setup";
import { safeNext } from "@/lib/next-path";
import { registerAccountEmail } from "@/lib/people/matching";

export async function checkHandle(input: string): Promise<{ ok: boolean; handle: string; message: string }> {
  await requireUser();
  const check = validateHandle(input);
  if (!check.ok) return { ok: false, handle: check.handle, message: check.reason };
  const { data } = await adminClient().from("agents").select("id").eq("handle", check.handle).maybeSingle();
  return data
    ? { ok: false, handle: check.handle, message: `@${check.handle} is taken.` }
    : { ok: true, handle: check.handle, message: `@${check.handle} is available.` };
}



const Base = z.object({
  type: z.enum(["personal", "business"]),
  display_name: z.string().trim().min(MIN_NAME, "Enter a name (at least 2 characters).").max(MAX_BUSINESS_NAME),
  handle: z.string(),
  avatar: z.string(),
});

const shareFlag = (v: FormDataEntryValue | null) => (v === "on" ? "contacts" : "private") as "contacts" | "private";
const optional = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The optional details, checked against the same limits the form shows (an error, never a silent cut). */
function checkDetails(form: FormData, isBusiness: boolean): string | null {
  const tooLong = (field: string, max: number) => (optional(form.get(field))?.length ?? 0) > max;
  if (!isBusiness) {
    for (const [field, label] of [["availability", "Usual availability"], ["food", "Food preferences"], ["notes", "Private notes"]] as const) {
      if (tooLong(field, SIGNUP_LIMITS.fact)) return `Keep "${label}" to ${SIGNUP_LIMITS.fact} characters.`;
    }
    return null;
  }
  if (tooLong("description", SIGNUP_LIMITS.description)) return `Keep the description to ${SIGNUP_LIMITS.description} characters. You can add more later in Business.`;
  if (tooLong("hours", SIGNUP_LIMITS.hours)) return `Keep opening hours to ${SIGNUP_LIMITS.hours} characters.`;
  for (const i of [1, 2, 3]) {
    const q = optional(form.get(`faq_q_${i}`));
    const a = optional(form.get(`faq_a_${i}`));
    if (q && !a) return `FAQ ${i}: add an answer, or clear the question.`;
    if (a && !q) return `FAQ ${i}: add the question, or clear the answer.`;
    if ((q?.length ?? 0) > SIGNUP_LIMITS.faqQuestion) return `FAQ ${i}: keep the question to ${SIGNUP_LIMITS.faqQuestion} characters.`;
    if ((a?.length ?? 0) > SIGNUP_LIMITS.faqAnswer) return `FAQ ${i}: keep the answer to ${SIGNUP_LIMITS.faqAnswer} characters.`;
  }
  return null;
}

export type OnboardingState = { error?: string } | undefined;

export async function createAgent(_prev: OnboardingState, form: FormData): Promise<OnboardingState> {
  const user = await requireUser();
  if (await getAgentForUser(user.id)) redirect("/chats");

  const parsed = Base.safeParse({
    type: form.get("type"),
    display_name: form.get("display_name"),
    handle: form.get("handle"),
    avatar: form.get("avatar"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (parsed.data.display_name.length > maxNameFor(parsed.data.type)) return { error: `Keep the name to ${maxNameFor(parsed.data.type)} characters.` };
  if (!avatarsFor(parsed.data.type).includes(parsed.data.avatar)) return { error: "Pick an avatar." };
  const handle = validateHandle(parsed.data.handle);
  if (!handle.ok) return { error: handle.reason };

  const isBusiness = parsed.data.type === "business";
  const detailsError = checkDetails(form, isBusiness);
  if (detailsError) return { error: detailsError };
  // "Have a website?": checked before anything is created; read once the agent exists.
  const website = isBusiness ? optional(form.get("website")) : null;
  if (website) {
    const site = normaliseSite(website, { allowLocal: allowLocal() });
    if (!site.ok) return { error: `Website: ${site.error}` };
  }
  const faqs = isBusiness
    ? [1, 2, 3]
        .map((i) => ({ q: optional(form.get(`faq_q_${i}`)), a: optional(form.get(`faq_a_${i}`)) }))
        .filter((f): f is { q: string; a: string } => Boolean(f.q && f.a))
    : [];

  const db = adminClient();
  const { data: agent, error } = await db
    .from("agents")
    .insert({
      owner_id: user.id,
      handle: handle.handle,
      display_name: parsed.data.display_name,
      avatar: parsed.data.avatar,
      type: parsed.data.type,
      // Businesses answer anyone's questions; people only hear from contacts.
      contact_policy: isBusiness ? "anyone" : "contacts_only",
      bio: isBusiness ? optional(form.get("description"))?.slice(0, 280) ?? null : null,
      business_info: isBusiness
        ? asJson({ description: optional(form.get("description")), hours: optional(form.get("hours")), faqs })
        : asJson({}),
    })
    .select("id")
    .single();
  if (error) {
    return { error: error.code === "23505" ? `@${handle.handle} was just taken. Try another.` : "Could not create your agent." };
  }

  // A business that signed up on its own manages itself (staff can be added later).
  if (isBusiness) await db.from("business_managers").insert({ business_agent_id: agent.id, user_id: user.id, role: "owner" });
  if (!isBusiness) {
    const facts = (["availability", "food", "notes"] as const)
      .map((category) => ({
        agent_id: agent.id,
        category,
        value: optional(form.get(category)),
        // Notes are never shareable from onboarding.
        disclosure: category === "notes" ? ("private" as const) : shareFlag(form.get(`share_${category}`)),
      }))
      .filter((f): f is typeof f & { value: string } => f.value !== null);
    if (facts.length) await db.from("agent_facts").insert(facts);
  }

  await registerAccountEmail(agent.id, user);
  const conv = await getOrCreateMyAgentConversation(user.id);
  const next = safeNext(form.get("next"), "");
  await postMessage({
    conversationId: conv.id,
    from: "agent",
    agentId: agent.id,
    content: isBusiness
      ? `Hi! I'm @${handle.handle}, your business agent. I answer visitors' questions using only the information you gave me, and I never take bookings or payments.`
      : `Hi ${parsed.data.display_name}! I'm @${handle.handle}, your agent. Connect with friends, then ask me something like "Arrange dinner with @marco on Saturday evening".`,
  });
  // A website: read it all now, then review what the agent learned (step by step) before going live.
  if (website && (await attachWebsite(agent.id, website, user)).ok) redirect("/business/setup");
  // Came from an invite or personal link: go back there to finish joining/connecting.
  redirect(next || `/chats/${conv.id}`);
}
