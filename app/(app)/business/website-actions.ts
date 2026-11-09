"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAgent, requireUser } from "@/lib/auth";
import { adminClient } from "@/lib/supabase/admin";
import { asJson } from "@/lib/data/json";
import { allowLocal, safeFetch } from "@/lib/business/fetch";
import { hasVerifyToken, homePreview, normaliseSite, verifiesByEmail, type SitePreview } from "@/lib/business/site";
import { openBusinessQuestions, readWebsite } from "@/lib/business/website";
import { attachWebsite, markVerified } from "@/lib/business/site-setup";
import { businessSources } from "@/lib/business/sources";
import { BASICS, itemKey, type BasicKey, type Correction } from "@/lib/business/learn";
import { draftBusinessAnswer } from "@/lib/agents/respond";
import { answerInboxItem, declineInboxItem } from "@/lib/plans/inbox";
import { realPerson } from "@/lib/identities";
import { describeRetry, hit } from "@/lib/limits";
import { withUsageContext } from "@/lib/usage/context";

type Out = { error?: string };
type Info = { faqs?: { q: string; a: string }[]; corrections?: Correction[] } & Record<string, unknown>;
const MAX_FAQS = 50;
const MAX_CORRECTIONS = 30;

async function requireBusiness() {
  const { user, agent } = await requireAgent();
  if (agent.type !== "business") throw new Error("Not a business account");
  return { user, agent };
}

/** Sign-up and Add a business: fill in the name, description, @address and picture from the homepage. */
export async function previewWebsiteAction(raw: string): Promise<Out & { preview?: SitePreview & { url: string } }> {
  const user = await requireUser();
  const site = normaliseSite(String(raw ?? ""), { allowLocal: allowLocal() });
  if (!site.ok) return { error: site.error };
  const limit = await hit("sitePreviewsPerUser", user.id);
  if (!limit.allowed) return { error: `Please wait ${describeRetry(limit.retryAfterSeconds)} and try again.` };
  try {
    const home = await safeFetch(site.url.toString());
    if (!home.contentType.includes("html")) return { error: "That address isn't a web page." };
    return { preview: { ...homePreview(home.body.toString("utf8"), new URL(home.finalUrl)), url: site.url.toString() } };
  } catch (error) {
    return { error: `Couldn't open ${site.domain}: ${error instanceof Error ? error.message : "no answer"}` };
  }
}

/** My Business: "Have a website? Paste it": read it all, then review. */
export async function startWebsiteAction(raw: string): Promise<Out> {
  const { user, agent } = await requireBusiness();
  const limit = await hit("siteReadsPerAgent", agent.id);
  if (!limit.allowed) return { error: `Please wait ${describeRetry(limit.retryAfterSeconds)} before reading a website again.` };
  const result = await attachWebsite(agent.id, String(raw ?? ""), await ownerEmail(user, agent));
  if (!result.ok) return { error: result.error };
  revalidatePath("/business");
  return {};
}

/** The verified email of the person behind this business (for automatic ✓ Verified). */
async function ownerEmail(user: Awaited<ReturnType<typeof requireAgent>>["user"], agent: Awaited<ReturnType<typeof requireAgent>>["agent"]) {
  const person = await realPerson(user, agent);
  if (!person) return { email: null, emailConfirmed: false };
  if (person === user.id) return { email: user.email ?? null, emailConfirmed: Boolean(user.emailConfirmed) };
  const { data } = await adminClient().auth.admin.getUserById(person);
  return { email: data.user?.email ?? null, emailConfirmed: Boolean(data.user?.email_confirmed_at) };
}

/** Live progress while the website is read ("Reading… Menu ✓"). */
export async function siteStatusAction(): Promise<{ status: string; pagesRead: number; pagesFound: number; progress: { title: string; url: string }[]; error: string | null } | null> {
  const { agent } = await requireBusiness();
  const { data } = await adminClient().from("business_sites").select("status, pages_read, pages_found, progress, error").eq("agent_id", agent.id).maybeSingle();
  if (!data) return null;
  return { status: data.status, pagesRead: data.pages_read, pagesFound: data.pages_found, progress: (data.progress ?? []) as { title: string; url: string }[], error: data.error };
}

export async function rereadWebsiteAction(): Promise<Out> {
  const { agent } = await requireBusiness();
  const limit = await hit("siteReadsPerAgent", agent.id);
  if (!limit.allowed) return { error: `Please wait ${describeRetry(limit.retryAfterSeconds)} before re-reading again.` };
  const { data } = await adminClient()
    .from("business_sites")
    .update({ status: "reading", pages_read: 0, pages_found: 0, progress: asJson([]), error: null })
    .eq("agent_id", agent.id)
    .is("reading_started_at", null)
    .select("agent_id");
  if (!data?.length) return { error: "Your website is being read right now." };
  after(() => readWebsite(agent.id, "manual"));
  revalidatePath("/business");
  return {};
}

/** Disconnects the website: its pages, what was learned and the ✓ Verified badge go. */
export async function removeWebsiteAction(): Promise<Out> {
  const { agent } = await requireBusiness();
  const db = adminClient();
  await db.from("business_sources").delete().eq("agent_id", agent.id).eq("origin", "site");
  await db.from("business_sites").delete().eq("agent_id", agent.id);
  await db.from("agents").update({ verified_domain: null }).eq("id", agent.id);
  revalidatePath("/business");
  return {};
}

/** ✕ Remove a learned item (or ↩ bring it back). */
export async function hideLearnedAction(key: string, hide: boolean): Promise<Out> {
  const { agent } = await requireBusiness();
  const db = adminClient();
  const { data: site } = await db.from("business_sites").select("hidden").eq("agent_id", agent.id).maybeSingle();
  if (!site) return { error: "Not found." };
  const k = String(key ?? "").slice(0, 200);
  const hidden = hide ? [...new Set([...site.hidden, k])].slice(-200) : site.hidden.filter((h) => h !== k);
  await db.from("business_sites").update({ hidden }).eq("agent_id", agent.id);
  revalidatePath("/business/setup");
  revalidatePath("/business");
  return {};
}

const Fix = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("basic"), key: z.enum(BASICS.map((b) => b.key) as [BasicKey, ...BasicKey[]]), value: z.string().trim().min(1).max(400) }),
  z.object({ kind: z.literal("fact"), label: z.string().trim().min(1).max(60), value: z.string().trim().min(1).max(400) }),
  z.object({ kind: z.literal("faq"), original: z.string().trim().min(1).max(300), q: z.string().trim().min(1).max(300), a: z.string().trim().min(1).max(1000) }),
]);

/**
 * ✏️ Fix something the website (or the summary) got wrong. A fixed fact or
 * basic becomes a correction (it beats the website from now on); a fixed
 * question becomes one of your own Questions & answers.
 */
export async function fixLearnedAction(input: unknown): Promise<Out> {
  const { agent } = await requireBusiness();
  const parsed = Fix.safeParse(input);
  if (!parsed.success) return { error: "Write the right answer first." };
  const fix = parsed.data;
  const db = adminClient();
  const info = (agent.business_info ?? {}) as Info;
  let hideKey: string;
  if (fix.kind === "faq") {
    const faqs = (info.faqs ?? []).filter((f) => f.q.trim().toLowerCase() !== fix.q.toLowerCase());
    if (faqs.length >= MAX_FAQS) return { error: `You can keep up to ${MAX_FAQS} questions.` };
    await db.from("agents").update({ business_info: asJson({ ...info, faqs: [...faqs, { q: fix.q, a: fix.a }] }) }).eq("id", agent.id);
    hideKey = itemKey.faq(fix.original);
  } else {
    const label = fix.kind === "basic" ? BASICS.find((b) => b.key === fix.key)!.label : fix.label;
    const corrections = [...(info.corrections ?? []).filter((c) => c.label.toLowerCase() !== label.toLowerCase()), { label, value: fix.value }].slice(-MAX_CORRECTIONS);
    await db.from("agents").update({ business_info: asJson({ ...info, corrections }) }).eq("id", agent.id);
    hideKey = fix.kind === "basic" ? itemKey.basic(fix.key) : itemKey.fact(fix.label);
  }
  const { data: site } = await db.from("business_sites").select("hidden").eq("agent_id", agent.id).maybeSingle();
  if (site) await db.from("business_sites").update({ hidden: [...new Set([...site.hidden, hideKey])].slice(-200) }).eq("agent_id", agent.id);
  revalidatePath("/business/setup");
  revalidatePath("/business");
  return {};
}

/** Removes one of the owner's corrections (the website's version is used again). */
export async function removeCorrectionAction(label: string): Promise<Out> {
  const { agent } = await requireBusiness();
  const info = (agent.business_info ?? {}) as Info;
  const corrections = (info.corrections ?? []).filter((c) => c.label !== String(label ?? ""));
  await adminClient().from("agents").update({ business_info: asJson({ ...info, corrections }) }).eq("id", agent.id);
  revalidatePath("/business/setup");
  revalidatePath("/business");
  return {};
}

/** 🚀 Go live: customers' agents now get answers from the website too. */
export async function goLiveAction(): Promise<Out> {
  const { agent } = await requireBusiness();
  const { data } = await adminClient()
    .from("business_sites")
    .update({ live_at: new Date().toISOString() })
    .eq("agent_id", agent.id)
    .eq("status", "ready")
    .select("agent_id");
  if (!data?.length) return { error: "Wait until your website has been read." };
  revalidatePath("/business");
  return {};
}

/** "Try it as a customer": the answer a visitor would get, website included (even before going live). */
export async function previewAnswerAction(question: string): Promise<Out & { answer?: string; needsTeam?: boolean; source?: string | null }> {
  const { user, agent } = await requireBusiness();
  const q = String(question ?? "").trim().slice(0, 500);
  if (!q) return { error: "Type a question a customer might ask." };
  const limit = await hit("agentMessagesPerUser", user.id);
  if (!limit.allowed) return { error: `Too many tries. Wait ${describeRetry(limit.retryAfterSeconds)}.` };
  const reply = await withUsageContext({ userId: user.id, agentId: agent.id }, async () =>
    draftBusinessAnswer(agent, q, await businessSources(agent.id, { preview: true }), "public"),
  );
  return { answer: reply.answer, needsTeam: reply.needs_team, source: reply.source };
}

/** ✓ Verified: with the owner's email at the website's domain, or the meta tag on the homepage. */
export async function verifyWebsiteAction(method: "email" | "meta"): Promise<Out & { verified?: boolean }> {
  const { user, agent } = await requireBusiness();
  const { data: site } = await adminClient().from("business_sites").select("url, domain, verify_token").eq("agent_id", agent.id).maybeSingle();
  if (!site) return { error: "Add your website first." };
  if (method === "email") {
    const owner = await ownerEmail(user, agent);
    if (!owner.emailConfirmed || !verifiesByEmail(owner.email, site.domain)) return { error: `Your verified email isn't at ${site.domain}. Use the code on your homepage instead.` };
  } else {
    const limit = await hit("sitePreviewsPerUser", user.id);
    if (!limit.allowed) return { error: `Please wait ${describeRetry(limit.retryAfterSeconds)} and try again.` };
    try {
      const home = await safeFetch(site.url);
      if (!hasVerifyToken(home.body.toString("utf8"), site.verify_token)) {
        return { error: "We couldn't find the code on your homepage yet. Check it's inside <head> and that your website has been published." };
      }
    } catch (error) {
      return { error: `Couldn't open your website: ${error instanceof Error ? error.message : "no answer"}` };
    }
  }
  const done = await markVerified(agent.id, site.domain);
  if (!done.ok) return { error: done.error };
  revalidatePath("/business");
  return { verified: true };
}

/** Clears "Changes on your website" (they expire after 30 days anyway). */
export async function clearSiteChangesAction(): Promise<Out> {
  const { user } = await requireBusiness();
  await adminClient().from("notices").update({ dismissed_at: new Date().toISOString() }).eq("user_id", user.id).eq("area", "business").eq("kind", "site_change").is("dismissed_at", null);
  revalidatePath("/business");
  return {};
}

const Ids = z.array(z.uuid()).min(1).max(100);

/**
 * "Answer once": the answer goes to everyone who asked (in their chat with the
 * business, from the team) and becomes one of your Questions & answers, so
 * the agent answers it by itself from now on.
 */
export async function answerGapAction(ids: string[], question: string, answer: string): Promise<Out & { sent?: number }> {
  const { user, agent } = await requireBusiness();
  const items = Ids.safeParse(ids);
  const q = String(question ?? "").trim().slice(0, 300);
  const a = String(answer ?? "").trim().slice(0, 1000);
  if (!items.success || !q) return { error: "Not found." };
  if (!a) return { error: "Write your answer first." };
  let sent = 0;
  await withUsageContext({ userId: user.id, agentId: agent.id }, async () => {
    for (const id of items.data) if ((await answerInboxItem(id, user.id, { answer: a }, false)).ok) sent++;
  });
  if (!sent) return { error: "These questions were already answered." };
  const info = (agent.business_info ?? {}) as Info;
  const faqs = (info.faqs ?? []).filter((f) => f.q.trim().toLowerCase() !== q.toLowerCase());
  if (faqs.length < MAX_FAQS) await adminClient().from("agents").update({ business_info: asJson({ ...info, faqs: [...faqs, { q, a }] }) }).eq("id", agent.id);
  await settleGapNotices(user.id, agent.id);
  revalidatePath("/business");
  revalidatePath("/chats", "layout");
  return { sent };
}

/** "We can't answer this": everyone who asked is told the team couldn't answer. */
export async function dismissGapAction(ids: string[]): Promise<Out> {
  const { user, agent } = await requireBusiness();
  const items = Ids.safeParse(ids);
  if (!items.success) return { error: "Not found." };
  for (const id of items.data) await declineInboxItem(id, user.id);
  await settleGapNotices(user.id, agent.id);
  revalidatePath("/business");
  revalidatePath("/chats", "layout");
  return {};
}

/** The weekly "customers asked about…" stops needing you once nothing is asked twice any more. */
async function settleGapNotices(userId: string, agentId: string) {
  if ((await openBusinessQuestions(agentId)).some((g) => g.items.length >= 2)) return;
  await adminClient().from("notices").update({ resolved_at: new Date().toISOString() }).eq("user_id", userId).eq("area", "business").eq("kind", "site_gap").is("resolved_at", null);
}
