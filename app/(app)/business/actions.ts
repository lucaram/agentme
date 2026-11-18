"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminClient } from "@/lib/supabase/admin";
import { addressKey, checkUrl, linksIn } from "@/lib/business/extract";
import { businessSources, readSource } from "@/lib/business/sources";
import { lookUpOnSite } from "@/lib/business/lookup";
import { allowLocal } from "@/lib/business/fetch";
import { draftBusinessAnswer } from "@/lib/agents/respond";
import { withUsageContext } from "@/lib/usage/context";
import { describeRetry, hit } from "@/lib/limits";
import { MAX_FEATURED, normaliseWay, type Way } from "@/lib/business/booking";
import { patchBusinessInfo } from "@/lib/business/profile";
import { markReading, pruneOfferings, readAllOfferings } from "@/lib/business/offerings";
import { FACILITIES, FACILITY_KEYS, KINDS, MAX_CUSTOM_FACILITIES, MAX_PRICES, MAX_TAGS, PRICE_TYPES, cleanTags, isCustomFacility } from "@/lib/business/offerings-shared";
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
export async function addSourceAction(url: string, visibility: string): Promise<Out> {
  const { agent } = await requireBusiness();
  const check = checkUrl(String(url ?? ""), { allowLocal: allowLocal() });
  if (!check.ok) return { error: check.error };
  const db = adminClient();
  const { data: existing } = await db.from("business_sources").select("id, url, origin").eq("agent_id", agent.id);
  const same = (existing ?? []).find((s) => addressKey(s.url) === addressKey(check.url.toString()));
  if (same?.origin === "link") return { error: "That link is already there." };
  if ((existing ?? []).filter((s) => s.origin === "link").length >= MAX_LINKS) return { error: `You can add up to ${MAX_LINKS} links.` };
  const shown = visibility === "customers" ? "customers" : "public";
  if (same) {
    // A page your website scan already read becomes your link: read once, not twice; what was read stays.
    await db.from("business_sources").update({ origin: "link", visibility: shown, status: "pending" }).eq("id", same.id);
    await db.from("business_prices").update({ visibility: shown }).eq("agent_id", agent.id).eq("source_url", same.url);
    await db.from("business_facilities").update({ visibility: shown }).eq("agent_id", agent.id).eq("source_url", same.url);
    after(() => readSource(same.id));
    revalidatePath("/business", "layout");
    return {};
  }
  const { data, error } = await db.from("business_sources").insert({ agent_id: agent.id, url: check.url.toString(), visibility: shown }).select("id").single();
  if (error || !data) {
    return { error: error?.code === "23505" ? "That link is already there." : "Couldn't add that link." };
  }
  after(() => readSource(data.id));
  revalidatePath("/business", "layout");
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
  const source = await ownSource(id, agent.id);
  if (!source) return { error: "Not found." };
  await adminClient().from("business_sources").delete().eq("id", source.id).eq("agent_id", agent.id);
  await pruneOfferings(agent.id);
  revalidatePath(`/u/${agent.handle}`);
  revalidatePath("/business");
  return {};
}

export async function setSourceVisibilityAction(id: string, visibility: string): Promise<Out> {
  const { agent } = await requireBusiness();
  const source = await ownSource(id, agent.id);
  if (!source) return { error: "Not found." };
  const next = visibility === "customers" ? "customers" : "public";
  await adminClient().from("business_sources").update({ visibility: next }).eq("id", id);
  await adminClient().from("business_prices").update({ visibility: next }).eq("agent_id", agent.id).eq("source_url", source.url);
  await adminClient().from("business_facilities").update({ visibility: next }).eq("agent_id", agent.id).eq("source_url", source.url);
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
    // One button per address: two would show customers the same link twice.
    const twin = ways.find((way) => way.kind === checked.way.kind && way.value === checked.way.value);
    if (twin) return { error: `There's already a button for ${checked.way.value}${twin.label ? ` (${twin.label})` : ""}. Keep one of them.` };
    ways.push(checked.way);
  }
  if (ways.filter((way) => way.primary).length > MAX_FEATURED) return { error: `Up to ${MAX_FEATURED} buttons can be shown first. Untick one.` };
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

// ------------------------------------------------------------- Prices & facilities (read from your website and documents)

const ItemInput = z.object({
  group_id: z.uuid().nullable(),
  kind: z.enum(KINDS),
  category: z.string().trim().max(60).nullable(),
  item: z.string().trim().min(1).max(120),
  description: z.string().trim().max(200).nullable(),
  tags: z.array(z.string().trim().max(30)).max(MAX_TAGS),
  price_type: z.enum(PRICE_TYPES),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/),
  duration_minutes: z.number().int().min(1).max(1440).nullable(),
  needs_booking: z.boolean(),
  options: z.array(z.object({ id: z.uuid().nullable(), label: z.string().trim().max(60).nullable(), price: z.number().min(0).max(99999).nullable() })).min(1).max(12),
});
export type ItemInputType = z.infer<typeof ItemInput>;

/**
 * Add a product or service, or change one (all its details and options at once). What you change wins
 * over the documents from then on: a later read only notes what they say. An option you take away from
 * an item read from a document is hidden (so the next read doesn't bring it back); one you added goes.
 */
export async function saveItemAction(input: ItemInputType): Promise<Out & { group_id?: string }> {
  const { agent } = await requireBusiness();
  const parsed = ItemInput.safeParse(input);
  if (!parsed.success) return { error: "Check the name, the options and their prices." };
  const d = parsed.data;
  const priced = d.price_type !== "free" && d.price_type !== "on_request";
  if (priced && d.options.some((o) => o.price === null || !Number.isFinite(o.price))) return { error: "Give each option a price, e.g. 8.50." };
  const labels = d.options.map((o) => (o.label ?? "").toLowerCase());
  if (new Set(labels).size !== labels.length) return { error: "Give each option a different name, e.g. 10-inch and 12-inch." };
  const db = adminClient();
  const existing = d.group_id ? ((await db.from("business_prices").select("*").eq("agent_id", agent.id).eq("group_id", d.group_id)).data ?? []) : [];
  if (d.group_id && !existing.length) return { error: "Not found." };
  const keep = new Set(d.options.flatMap((o) => (o.id ? [o.id] : [])));
  if ([...keep].some((id) => !existing.some((row) => row.id === id))) return { error: "Not found." };
  const { count } = await db.from("business_prices").select("id", { count: "exact", head: true }).eq("agent_id", agent.id);
  const adding = d.options.filter((o) => !o.id).length;
  if ((count ?? 0) + adding > MAX_PRICES) return { error: `You can have up to ${MAX_PRICES} prices.` };
  const group = d.group_id ?? crypto.randomUUID();
  const fields = {
    kind: d.kind, category: d.category || null, item: d.item, description: d.description || null, tags: cleanTags(d.tags), price_type: d.price_type,
    currency: d.currency.toUpperCase(), duration_minutes: d.kind === "service" ? d.duration_minutes : null, needs_booking: d.kind === "service" && d.needs_booking,
    corrected: true, updated_at: new Date().toISOString(),
  };
  const amount = (price: number | null) => (d.price_type === "free" ? 0 : d.price_type === "on_request" ? null : Math.round((price ?? 0) * 100) / 100);
  for (const option of d.options) {
    if (option.id) await db.from("business_prices").update({ ...fields, variant: option.label || null, price: amount(option.price), hidden: false }).eq("id", option.id).eq("agent_id", agent.id);
    else await db.from("business_prices").insert({ ...fields, agent_id: agent.id, group_id: group, variant: option.label || null, price: amount(option.price), added: true, visibility: existing[0]?.visibility ?? "public" });
  }
  for (const row of existing.filter((r) => !keep.has(r.id))) {
    if (row.added) await db.from("business_prices").delete().eq("id", row.id);
    else await db.from("business_prices").update({ ...fields, hidden: true }).eq("id", row.id);
  }
  revalidatePath("/business", "layout");
  return { group_id: group };
}

/** Hide a product or service from your agent (and show it again). */
export async function hideItemAction(groupId: string, hidden: boolean): Promise<Out> {
  const { agent } = await requireBusiness();
  if (!z.uuid().safeParse(groupId).success) return { error: "Not found." };
  await adminClient().from("business_prices").update({ hidden: Boolean(hidden), updated_at: new Date().toISOString() }).eq("agent_id", agent.id).eq("group_id", groupId);
  revalidatePath("/business", "layout");
  return {};
}

/** Delete something you added yourself (what was read from a document is hidden instead, so it doesn't come back). */
export async function deleteItemAction(groupId: string): Promise<Out> {
  const { agent } = await requireBusiness();
  if (!z.uuid().safeParse(groupId).success) return { error: "Not found." };
  const db = adminClient();
  const { data: rows } = await db.from("business_prices").select("id, added").eq("agent_id", agent.id).eq("group_id", groupId);
  if (!rows?.length) return { error: "Not found." };
  if (rows.some((r) => !r.added)) return { error: "This was read from your documents: hide it instead, so it doesn't come back." };
  await db.from("business_prices").delete().eq("agent_id", agent.id).eq("group_id", groupId);
  revalidatePath("/business", "layout");
  return {};
}

const FacilityInput = z.object({
  key: z.string().trim().max(40).nullable(),
  label: z.string().trim().max(60).nullable(),
  status: z.enum(["yes", "no"]),
  note: z.string().trim().max(300).nullable(),
});

/**
 * Add or change a facility: one of the common ones (by key), or your own (a name; a new one gets a key).
 * What you set is confirmed: it wins over anything read later. Keeping the same answer keeps the words
 * it was read from, unless you write your own details.
 */
export async function saveFacilityAction(input: { key: string | null; label: string | null; status: "yes" | "no"; note: string | null }): Promise<Out & { key?: string }> {
  const { agent } = await requireBusiness();
  const parsed = FacilityInput.safeParse(input);
  if (!parsed.success) return { error: "Choose Yes or No, and keep the name and details short." };
  const { status } = parsed.data;
  const db = adminClient();
  let key = parsed.data.key;
  const label = parsed.data.label || null;
  if (key && !(FACILITY_KEYS as readonly string[]).includes(key) && !isCustomFacility(key)) return { error: "Not found." };
  if (!key || isCustomFacility(key)) {
    if (!label) return { error: "Give it a name, e.g. Live music." };
    // Your own facility with a common one's name is that common one.
    const common = FACILITIES.find((f) => f.label.toLowerCase() === label.toLowerCase());
    if (!key && common) key = common.key;
  }
  const { data: rows } = await db.from("business_facilities").select("*").eq("agent_id", agent.id);
  if (!key) {
    const same = (rows ?? []).find((r) => isCustomFacility(r.key) && r.label?.toLowerCase() === label!.toLowerCase());
    if (same) key = same.key;
    else {
      if ((rows ?? []).filter((r) => isCustomFacility(r.key)).length >= MAX_CUSTOM_FACILITIES) return { error: `You can add up to ${MAX_CUSTOM_FACILITIES} facilities of your own.` };
      key = `custom-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
    }
  }
  const current = (rows ?? []).find((r) => r.key === key);
  const keepWords = current && !current.hidden && current.status === status && !parsed.data.note;
  const { error } = await db.from("business_facilities").upsert({
    agent_id: agent.id, key, status,
    label: isCustomFacility(key) ? label ?? current?.label ?? null : null,
    evidence: keepWords ? current.evidence : parsed.data.note || null,
    source_url: keepWords ? current.source_url : null,
    source_label: keepWords ? current.source_label : null,
    visibility: current?.visibility ?? "public",
    confirmed: true, hidden: false, updated_at: new Date().toISOString(),
  });
  revalidatePath("/business", "layout");
  return error ? { error: "Couldn't save that facility." } : { key };
}

/**
 * Remove a facility. Your own go; a common one is set aside, so a document mentioning it later doesn't
 * bring it back (add it again any time).
 */
export async function removeFacilityAction(key: string): Promise<Out> {
  const { agent } = await requireBusiness();
  const db = adminClient();
  if (isCustomFacility(key)) await db.from("business_facilities").delete().eq("agent_id", agent.id).eq("key", key);
  else if ((FACILITY_KEYS as readonly string[]).includes(key)) {
    const { data: current } = await db.from("business_facilities").select("status").eq("agent_id", agent.id).eq("key", key).maybeSingle();
    await db.from("business_facilities").upsert({ agent_id: agent.id, key, status: current?.status ?? "no", evidence: null, source_url: null, source_label: null, confirmed: true, hidden: true, updated_at: new Date().toISOString() });
  } else return { error: "Not found." };
  revalidatePath("/business", "layout");
  return {};
}

/** "Scan": read every document and page for prices and facilities now. */
export async function rereadOfferingsAction(): Promise<Out> {
  const { user, agent } = await requireBusiness();
  if (!(await hit("offeringsRereadsPerAgent", agent.id)).allowed) return { error: "You've done this a lot just now. Try again in a few minutes." };
  await markReading(agent.id); // the pages show it straight away
  after(() => withUsageContext({ agentId: agent.id, userId: user.id }, () => readAllOfferings(agent.id, { force: true })));
  revalidatePath("/business", "layout");
  return {};
}
