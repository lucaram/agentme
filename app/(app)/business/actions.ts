"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminClient } from "@/lib/supabase/admin";
import { checkUrl, linksIn } from "@/lib/business/extract";
import { businessSources, readSource } from "@/lib/business/sources";
import { lookUpOnSite } from "@/lib/business/lookup";
import { allowLocal } from "@/lib/business/fetch";
import { draftBusinessAnswer } from "@/lib/agents/respond";
import { withUsageContext } from "@/lib/usage/context";
import { describeRetry, hit } from "@/lib/limits";
import { normaliseWay, waysOf, type Way } from "@/lib/business/booking";
import { patchBusinessInfo } from "@/lib/business/profile";
import { requireBusinessPermission } from "@/lib/business/access";
import { BUSINESS_LIMITS } from "@/lib/social/limits";

type Out = { error?: string };
const MAX_LINKS = 20;

async function requireBusiness() {
  const { user, agent } = await requireBusinessPermission("configure");
  if (agent.type !== "business") throw new Error("Not a business account");
  return { user, agent };
}

type Info = { about?: string; customers?: string; description?: string; hours?: string; faqs?: { q: string; a: string }[] };

/** "About your business" (public) and "For customers only", in plain language. */

export async function saveBusinessInfoAction(_prev: Out | undefined, form: FormData): Promise<Out & { saved?: boolean; addedLinks?: number }> {
  const { agent } = await requireBusiness();
  const hasAbout = form.has("about");
  const hasCustomers = form.has("customers");
  const about = hasAbout ? String(form.get("about") ?? "").trim() : "";
  if (about.length > BUSINESS_LIMITS.about) return { error: `Keep About your business to ${BUSINESS_LIMITS.about.toLocaleString("en-GB")} characters (it has ${about.length.toLocaleString("en-GB")}). Longer details belong in Q&A or Website & documents.` };
  const customers = hasCustomers ? String(form.get("customers") ?? "").trim().slice(0, 4000) : "";
  if (!hasAbout && !hasCustomers) return { error: "No changes to save." };
  if (hasAbout && !about) return { error: "Tell your agent a little about your business." };
  const db = adminClient();
  await patchBusinessInfo(agent.id, { ...(hasAbout ? { about, description: about.slice(0, 500) } : {}), ...(hasCustomers ? { customers } : {}) }, hasAbout ? about.split("\n")[0].slice(0, 280) : undefined);

  // Links written in either description become documents with the same visibility.
  const { count } = await db.from("business_sources").select("*", { count: "exact", head: true }).eq("agent_id", agent.id).eq("origin", "link");
  let room = MAX_LINKS - (count ?? 0);
  let addedLinks = 0;
  for (const [text, visibility] of [[about, "public"], [customers, "customers"]] as const) {
    for (const raw of linksIn(text)) {
      const check = checkUrl(raw, { allowLocal: allowLocal() });
      if (!check.ok || room <= 0) continue;
      const { data } = await db
        .from("business_sources")
        .upsert({ agent_id: agent.id, url: check.url.toString(), visibility }, { onConflict: "agent_id,url", ignoreDuplicates: true })
        .select("id");
      if (data?.length) {
        room--;
        addedLinks++;
        after(() => readSource(data[0].id));
      }
    }
  }
  revalidatePath("/business");
  return { saved: true, addedLinks };
}

export async function removeFaqAction(index: number): Promise<Out> {
  const { agent } = await requireBusiness();
  const info = (agent.business_info ?? {}) as Info;
  const faqs = (info.faqs ?? []).filter((_, i) => i !== index);
  await patchBusinessInfo(agent.id, { faqs });
  revalidatePath("/business");
  return {};
}

/** A link your agent reads: your website, a PDF menu, a photo of your menu. Read in the background. */
export async function addSourceAction(url: string, visibility: string, options?: { buttonLabel?: string }): Promise<Out> {
  const { agent } = await requireBusiness();
  const check = checkUrl(String(url ?? ""), { allowLocal: allowLocal() });
  if (!check.ok) return { error: check.error };
  if (options?.buttonLabel) {
    if (visibility !== "public") return { error: "Customer buttons can only link to public documents." };
    const button = normaliseWay("custom", check.url.toString(), { label: options.buttonLabel, purpose: "information" });
    if (!button.ok) return { error: button.error };
  }
  const db = adminClient();
  const { count } = await db.from("business_sources").select("*", { count: "exact", head: true }).eq("agent_id", agent.id).eq("origin", "link");
  if ((count ?? 0) >= MAX_LINKS) return { error: `You can add up to ${MAX_LINKS} links.` };
  const { data, error } = await db
    .from("business_sources")
    .insert({ agent_id: agent.id, url: check.url.toString(), visibility: visibility === "customers" ? "customers" : "public" })
    .select("id")
    .single();
  if (error || !data) {
    if (error?.code === "23505" && options?.buttonLabel) {
      const { data: existing } = await db.from("business_sources").select("id").eq("agent_id", agent.id).eq("url", check.url.toString()).maybeSingle();
      if (existing) return createSourceButtonAction(existing.id, options.buttonLabel);
    }
    return { error: error?.code === "23505" ? "That link is already there." : "Couldn't add that link." };
  }
  if (options?.buttonLabel) {
    const result = await createSourceButtonAction(data.id, options.buttonLabel);
    if (result.error) return result;
  }
  after(() => readSource(data.id));
  revalidatePath("/business");
  return {};
}

/** Reuse a public source URL as a customer button without adding another source. */
export async function createSourceButtonAction(sourceId: string, label: string): Promise<Out> {
  const { agent } = await requireBusiness();
  const { data: source } = await adminClient().from("business_sources").select("url, visibility").eq("id", String(sourceId)).eq("agent_id", agent.id).maybeSingle();
  if (!source) return { error: "Document not found." };
  if (source.visibility !== "public") return { error: "Customer buttons can only link to public documents." };
  const button = normaliseWay("custom", source.url, { label: String(label), purpose: "information" });
  if (!button.ok) return { error: button.error };
  const ways = waysOf(agent.business_info);
  if (!ways.some((way) => way.value === button.way.value && way.label === button.way.label)) await patchBusinessInfo(agent.id, { ways: [...ways, button.way] });
  revalidatePath("/business");
  revalidatePath(`/u/${agent.handle}`);
  return {};
}

async function ownSource(id: string, agentId: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const { data } = await adminClient().from("business_sources").select("id, url").eq("id", id).eq("agent_id", agentId).maybeSingle();
  return data;
}

export async function rereadSourceAction(id: string): Promise<Out> {
  const { agent } = await requireBusiness();
  if (!(await ownSource(id, agent.id))) return { error: "Not found." };
  const limit = await hit("businessRereadsPerAgent", agent.id);
  if (!limit.allowed) return { error: `Please wait ${describeRetry(limit.retryAfterSeconds)} before re-reading again.` };
  await adminClient().from("business_sources").update({ status: "pending" }).eq("id", id);
  after(() => readSource(id));
  revalidatePath("/business");
  return {};
}

export async function removeSourceAction(id: string): Promise<Out> {
  const { agent } = await requireBusiness();
  await adminClient().from("business_sources").delete().eq("id", String(id ?? "")).eq("agent_id", agent.id);
  revalidatePath("/business");
  return {};
}

export async function setSourceVisibilityAction(id: string, visibility: string): Promise<Out> {
  const { agent } = await requireBusiness();
  const source = await ownSource(id, agent.id);
  if (!source) return { error: "Not found." };
  if (visibility === "customers") await patchBusinessInfo(agent.id, { ways: waysOf(agent.business_info).filter((way) => way.value !== source.url) });
  await adminClient().from("business_sources").update({ visibility: visibility === "customers" ? "customers" : "public" }).eq("id", id);
  revalidatePath("/business");
  return {};
}

/** "Try it": what your agent would answer a visitor (or a customer), before anyone asks. */
export async function tryQuestionAction(question: string, asCustomer: boolean): Promise<Out & { answer?: string; needsTeam?: boolean }> {
  const { user, agent } = await requireBusiness();
  const q = String(question ?? "").trim().slice(0, 500);
  if (!q) return { error: "Type a question a customer might ask." };
  const limit = await hit("agentMessagesPerUser", user.id);
  if (!limit.allowed) return { error: `Too many tries. Wait ${describeRetry(limit.retryAfterSeconds)}.` };
  const reply = await withUsageContext({ userId: user.id, agentId: agent.id }, async () =>
    draftBusinessAnswer(agent, q, await businessSources(agent.id), asCustomer ? "customers" : "public"),
  );
  // Like a real question: not in what it has read → it looks on your website.
  const looked = reply.needs_team ? await withUsageContext({ userId: user.id, agentId: agent.id }, () => lookUpOnSite(agent, q, asCustomer ? "customers" : "public")).catch(() => null) : null;
  return { answer: (looked ?? reply).answer, needsTeam: (looked ?? reply).needs_team };
}

const MAX_FAQS = 50;

/** Add a question & answer your agent can use. */
export async function addFaqAction(question: string, answer: string): Promise<Out> {
  const { agent } = await requireBusiness();
  const q = String(question ?? "").trim().slice(0, 300);
  const a = String(answer ?? "").trim().slice(0, 1000);
  if (!q || !a) return { error: "Write both the question and the answer." };
  const info = (agent.business_info ?? {}) as Info;
  const faqs = info.faqs ?? [];
  if (faqs.length >= MAX_FAQS) return { error: `You can keep up to ${MAX_FAQS} questions.` };
  await patchBusinessInfo(agent.id, { faqs: [...faqs, { q, a }] });
  revalidatePath("/business");
  return {};
}

export async function updateFaqAction(index: number, question: string, answer: string): Promise<Out> {
  const { agent } = await requireBusiness();
  const q = String(question ?? "").trim().slice(0, 300);
  const a = String(answer ?? "").trim().slice(0, 1000);
  if (!q || !a) return { error: "Write both the question and the answer." };
  const info = (agent.business_info ?? {}) as Info;
  const faqs = [...(info.faqs ?? [])];
  if (!Number.isInteger(index) || !faqs[index]) return { error: "Not found." };
  faqs[index] = { q, a };
  await patchBusinessInfo(agent.id, { faqs });
  revalidatePath("/business");
  return {};
}

/** "How customers book or order": the business's own ways (AGENTME never books or takes orders). */
export async function saveWaysAction(input: { kind: string; value: string; label?: string; purpose?: string; primary?: boolean }[]): Promise<Out & { saved?: boolean }> {
  const { agent } = await requireBusiness();
  const rows = (Array.isArray(input) ? input : []).filter((w) => String(w?.value ?? "").trim());
  const ways: Way[] = [];
  for (const row of rows) {
    const checked = normaliseWay(String(row.kind), String(row.value), row);
    if (!checked.ok) return { error: checked.error };
    ways.push(checked.way);
  }
  await patchBusinessInfo(agent.id, { ways });
  revalidatePath("/business");
  revalidatePath("/chats", "layout");
  revalidatePath(`/u/${agent.handle}`);
  return { saved: true };
}

export async function saveBusinessDetailsAction(_prev: Out | undefined, form: FormData): Promise<Out & { saved?: boolean }> {
  const { agent } = await requireBusiness();
  const corrections = ((agent.business_info as { corrections?: { label: string; value: string }[] } | null)?.corrections ?? []).filter((correction) => !/^(opening hours|hours|address|business address)$/i.test(correction.label.trim()));
  const hours = String(form.get("hours") ?? "").trim();
  const address = String(form.get("address") ?? "").trim();
  if (hours.length > BUSINESS_LIMITS.hours) return { error: `Keep opening hours to ${BUSINESS_LIMITS.hours} characters.` };
  if (address.length > BUSINESS_LIMITS.address) return { error: `Keep the address to ${BUSINESS_LIMITS.address} characters.` };
  await patchBusinessInfo(agent.id, { hours, address, corrections });
  revalidatePath("/business");
  revalidatePath(`/u/${agent.handle}`);
  return { saved: true };
}
