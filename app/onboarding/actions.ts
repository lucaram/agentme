"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { adminClient } from "@/lib/supabase/admin";
import { getAgentForUser } from "@/lib/data/agents";
import { getOrCreateMyAgentConversation, postMessage } from "@/lib/data/chat";
import { validateHandle } from "@/lib/policy/handles";
import { asJson } from "@/lib/data/json";
import { AVATARS } from "@/lib/avatars";
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
  display_name: z.string().trim().min(1, "Enter a name.").max(60),
  handle: z.string(),
  avatar: z.string().refine((a) => AVATARS.includes(a), "Pick an avatar."),
});

const shareFlag = (v: FormDataEntryValue | null) => (v === "on" ? "contacts" : "private") as "contacts" | "private";
const optional = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 500) : null);

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
  const handle = validateHandle(parsed.data.handle);
  if (!handle.ok) return { error: handle.reason };

  const isBusiness = parsed.data.type === "business";
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
  // Came from an invite or personal link: go back there to finish joining/connecting.
  redirect(next || `/chats/${conv.id}`);
}
