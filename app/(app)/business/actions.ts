"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAgent } from "@/lib/auth";
import { adminClient } from "@/lib/supabase/admin";
import { asJson } from "@/lib/data/json";
import { checkUrl } from "@/lib/business/extract";
import { businessSources, readSource } from "@/lib/business/sources";
import { draftBusinessAnswer } from "@/lib/agents/respond";
import { withUsageContext } from "@/lib/usage/context";
import { describeRetry, hit } from "@/lib/limits";

type Out = { error?: string };
const MAX_LINKS = 20;

async function requireBusiness() {
  const { user, agent } = await requireAgent();
  if (agent.type !== "business") throw new Error("Not a business account");
  return { user, agent };
}

type Info = { about?: string; customers?: string; description?: string; hours?: string; faqs?: { q: string; a: string }[] };

/** "About your business" (public) and "For customers only", in plain language. */
/** Web addresses written in the text ("our menu: https://…"), to add as links the agent reads. */
function linksIn(text: string): string[] {
  return [...new Set((text.match(/https?:\/\/[^\s<>"')]+/gi) ?? []).map((u) => u.replace(/[.,;:!?]+$/, "")))];
}

export async function saveBusinessInfoAction(_prev: Out | undefined, form: FormData): Promise<Out & { saved?: boolean; addedLinks?: number }> {
  const { agent } = await requireBusiness();
  const about = String(form.get("about") ?? "").trim().slice(0, 8000);
  const customers = String(form.get("customers") ?? "").trim().slice(0, 4000);
  if (!about) return { error: "Tell your agent a little about your business." };
  const info = (agent.business_info ?? {}) as Info;
  const db = adminClient();
  await db
    .from("agents")
    .update({ bio: about.split("\n")[0].slice(0, 280), business_info: asJson({ ...info, about, customers, description: about.slice(0, 500) }) })
    .eq("id", agent.id);

  // Links written in the text are added to "Links your agent reads" (with the visibility of the box they're in).
  const { count } = await db.from("business_sources").select("*", { count: "exact", head: true }).eq("agent_id", agent.id);
  let room = MAX_LINKS - (count ?? 0);
  let addedLinks = 0;
  for (const [text, visibility] of [[about, "public"], [customers, "customers"]] as const) {
    for (const raw of linksIn(text)) {
      const check = checkUrl(raw);
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
  await adminClient().from("agents").update({ business_info: asJson({ ...info, faqs }) }).eq("id", agent.id);
  revalidatePath("/business");
  return {};
}

/** A link your agent reads: your website, a PDF menu, a photo of your menu. Read in the background. */
export async function addSourceAction(url: string, visibility: string): Promise<Out> {
  const { agent } = await requireBusiness();
  const check = checkUrl(String(url ?? ""));
  if (!check.ok) return { error: check.error };
  const db = adminClient();
  const { count } = await db.from("business_sources").select("*", { count: "exact", head: true }).eq("agent_id", agent.id);
  if ((count ?? 0) >= MAX_LINKS) return { error: `You can add up to ${MAX_LINKS} links.` };
  const { data, error } = await db
    .from("business_sources")
    .insert({ agent_id: agent.id, url: check.url.toString(), visibility: visibility === "customers" ? "customers" : "public" })
    .select("id")
    .single();
  if (error || !data) return { error: error?.code === "23505" ? "That link is already there." : "Couldn't add that link." };
  after(() => readSource(data.id));
  revalidatePath("/business");
  return {};
}

async function ownSource(id: string, agentId: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const { data } = await adminClient().from("business_sources").select("id").eq("id", id).eq("agent_id", agentId).maybeSingle();
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
  if (!(await ownSource(id, agent.id))) return { error: "Not found." };
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
  return { answer: reply.answer, needsTeam: reply.needs_team };
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
  await adminClient().from("agents").update({ business_info: asJson({ ...info, faqs: [...faqs, { q, a }] }) }).eq("id", agent.id);
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
  await adminClient().from("agents").update({ business_info: asJson({ ...info, faqs }) }).eq("id", agent.id);
  revalidatePath("/business");
  return {};
}
