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
import { prepareAvatar, commitAvatar, pruneAvatarFiles } from "@/lib/profile/avatar-server";
import { after } from "next/server";
import { avatarsFor } from "@/lib/avatars";
import { normaliseSite } from "@/lib/business/site";
import { allowLocal } from "@/lib/business/fetch";
import { attachWebsite } from "@/lib/business/site-setup";
import { safeNext } from "@/lib/next-path";
import { registerAccountEmail } from "@/lib/people/matching";
import { businessSignupDetails, handleCandidates } from "@/lib/onboarding/details";

export async function suggestAvailableHandle(name: string): Promise<{ ok: boolean; handle: string; message: string }> {
  await requireUser(); const candidates = handleCandidates(typeof name === "string" ? name.slice(0, 80) : "user");
  const { data, error } = await adminClient().from("agents").select("handle").in("handle", candidates);
  const handle = candidates.find((candidate) => !data?.some((row) => row.handle === candidate));
  return error || !handle ? { ok: false, handle: candidates[0], message: "Choose an address and check its availability." } : { ok: true, handle, message: `@${handle} is available.` };
}

export async function checkHandle(input: string): Promise<{ ok: boolean; handle: string; message: string }> {
  await requireUser();
  const check = validateHandle(input);
  if (!check.ok) return { ok: false, handle: check.handle, message: check.reason };
  const { data, error } = await adminClient().from("agents").select("id").eq("handle", check.handle).maybeSingle();
  if (error) return { ok: false, handle: check.handle, message: "Couldn't check this address. Please try again." };
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
  const details = businessSignupDetails(form); return details.ok ? null : details.error;
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
  const business = businessSignupDetails(form);
  if (isBusiness && !business.ok) return { error: business.error };
  // "Have a website?": checked before anything is created; read once the agent exists.
  const website = isBusiness ? optional(form.get("website")) : null;
  let websiteUrl: string | null = null;
  if (website) {
    const site = normaliseSite(website, { allowLocal: allowLocal() });
    if (!site.ok) return { error: `Website: ${site.error}` };
    websiteUrl = site.url.toString();
  }
  const details = isBusiness && business.ok ? business.details : null;

  let image: Buffer | null;
  try { image = await prepareAvatar(form, user.actorId ?? user.id); } catch (error) { return { error: error instanceof Error ? error.message : "Couldn't prepare your avatar." }; }
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
      bio: details?.description?.slice(0, 280) ?? null,
      business_info: isBusiness
        ? asJson({ about: details?.description ?? "", description: details?.description, hours: details?.hours, faqs: details?.faqs ?? [], ...(websiteUrl ? { website: websiteUrl } : {}) })
        : asJson({}),
    })
    .select("id")
    .single();
  if (error) {
    return { error: error.code === "23505" ? `@${handle.handle} was just taken. Try another.` : "Could not create your agent." };
  }

  // A business that signed up on its own manages itself (staff can be added later).
  if (isBusiness) {
    const manager = await db.from("business_managers").insert({ business_agent_id: agent.id, user_id: user.id, role: "owner" });
    if (manager.error) { await db.from("agents").delete().eq("id", agent.id); return { error: "Couldn't finish creating your business. Please try again." }; }
  }
  if (image) {
    try { await commitAvatar(agent.id, user.actorId ?? user.id, image, parsed.data.avatar); }
    catch (error) { await db.from("agents").delete().eq("id", agent.id); after(pruneAvatarFiles); return { error: error instanceof Error ? error.message : "Couldn't save your avatar." }; }
  }
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
    if (facts.length) {
      const saved = await db.from("agent_facts").insert(facts);
      if (saved.error) { await db.from("agents").delete().eq("id", agent.id); return { error: "Couldn't save your optional details. Please try again." }; }
    }
  }
  after(pruneAvatarFiles);
  await db.from("onboarding_state").insert({ user_id: user.id });

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
  // Read in the background; the owner can review and publish later in My Business.
  if (website) {
    const attached = await attachWebsite(agent.id, website, user);
    if (attached.ok) redirect(next || `/chats/${conv.id}`);
    redirect(next || `/business?website=${encodeURIComponent(website)}&website_error=1`);
  }
  // Came from an invite or personal link: go back there to finish joining/connecting.
  redirect(next || `/chats/${conv.id}`);
}
