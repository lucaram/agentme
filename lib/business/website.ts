import "server-only";
import { createHash } from "node:crypto";
import { adminClient } from "@/lib/supabase/admin";
import { llm } from "@/lib/llm";
import { withUsageContext } from "@/lib/usage/context";
import { SITE_CHANGES_SYSTEM, SITE_LEARN_SYSTEM, wrapUntrusted } from "@/lib/agents/prompts";
import { asJson } from "@/lib/data/json";
import { notify } from "@/lib/social/shared";
import { htmlToText } from "./extract";
import { safeFetch, type Fetched } from "./fetch";
import { readWithAi } from "./sources";
import { LearnedDraftSchema, clampLearned, learnedOf, type Learned, type PageText } from "./learn";
import { groupQuestions } from "./gaps";
import { indexSite } from "./site-index";
import {
  MAX_PAGE_TEXT,
  MAX_SITE_PAGES,
  MAX_SITE_PDFS,
  THIN_SITE_CHARS,
  candidateUrl,
  changedLines,
  linksOnPage,
  pageTitle,
  rankUrls,
  robotsAllows,
  robotsRules,
  scopeOf,
  shortUrl,
  siteDomain,
  sitemapLocs,
  type RobotsRules,
} from "./site";

/**
 * "Paste your website": reads a business's whole site in the background
 * (robots.txt respected, key pages first, the same safe fetching as links),
 * stores each page with the links the agent reads, learns the basics, facts
 * and likely questions, and on later reads tells the owner what changed.
 */

const CONCURRENCY = 4;
/** Website text sent to the model to learn from (key pages first). */
const LEARN_BUDGET = 60_000;
const MAX_SITEMAPS = 3;
/** A read that started this long ago and never finished was interrupted (e.g. a restart). */
const STUCK_MINUTES = 20;
export const SITE_REFRESH_HOURS = 24;

type Reason = "first" | "manual" | "refresh";
type Existing = { url: string; origin: string; content: string | null; content_hash: string | null; title: string | null };

const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 32);
const quietly = async (url: string): Promise<Fetched | null> => {
  try {
    return await safeFetch(url);
  } catch {
    return null;
  }
};
const mediaType = (f: Fetched) => f.contentType.split(";")[0].trim();

export const THIN_SITE_WARNING =
  "Your website builds its pages in the browser, so there's very little text for your agent to read. Add a PDF or a photo of your menu or price list under Links instead.";

/** Reads (or re-reads) a business's website. Safe to call in the background. */
export async function readWebsite(agentId: string, reason: Reason): Promise<void> {
  const db = adminClient();
  const { data: site } = await db.from("business_sites").select("*").eq("agent_id", agentId).maybeSingle();
  if (!site) return;
  // Already being read (and not stuck): don't read it twice at once.
  if (site.reading_started_at && Date.parse(site.reading_started_at) > Date.now() - STUCK_MINUTES * 60_000) return;
  const { data: agent } = await db.from("agents").select("owner_id").eq("id", agentId).maybeSingle();
  if (!agent) return;
  // The owner sees "Reading…" for a first read or "Re-read now"; the daily check happens quietly.
  const visible = reason !== "refresh";
  await db
    .from("business_sites")
    .update({
      reading_started_at: new Date().toISOString(),
      ...(visible ? { status: "reading", pages_read: 0, pages_found: 0, progress: asJson([]), error: null, warning: null } : {}),
    })
    .eq("agent_id", agentId);

  try {
    await withUsageContext({ agentId, userId: agent.owner_id }, () => crawl(agentId, agent.owner_id, site.url, site.live_at, learnedOf(site.learned), reason));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn't read your website.";
    await db
      .from("business_sites")
      .update({
        // A failed daily check keeps answering from what was read before.
        ...(visible ? { status: "error" } : {}),
        error: message.slice(0, 300),
        last_read_at: new Date().toISOString(),
        reading_started_at: null,
      })
      .eq("agent_id", agentId);
  }
}

async function crawl(agentId: string, ownerId: string, siteUrl: string, liveAt: string | null, previous: Learned, reason: Reason) {
  const db = adminClient();
  const start = new URL(siteUrl);
  const robotsFile = await quietly(new URL("/robots.txt", start).toString());
  const rules: RobotsRules =
    robotsFile && mediaType(robotsFile).startsWith("text/") ? robotsRules(robotsFile.body.toString("utf8")) : { allow: [], disallow: [], sitemaps: [] };

  let home: Fetched;
  try {
    home = await safeFetch(siteUrl);
  } catch (error) {
    throw new Error(`Couldn't open ${shortUrl(siteUrl)}: ${error instanceof Error ? error.message : "no answer"}`);
  }
  const base = new URL(home.finalUrl);
  base.hash = "";
  base.search = "";
  const scope = scopeOf(base);
  const homeUrl = base.toString();
  if (!robotsAllows(rules, base.pathname)) {
    throw new Error("Your website's robots.txt asks bots not to read it, so your agent respects that. You can still add pages under Links.");
  }

  // Candidates: the sitemap(s), then links found on the pages read.
  const fromSitemaps: string[] = [];
  const sitemapQueue = [...rules.sitemaps, new URL("/sitemap.xml", base).toString(), ...(scope !== "/" ? [new URL(`${scope}sitemap.xml`, base).toString()] : [])];
  const triedSitemaps = new Set<string>();
  const ownSite = (raw: string) => {
    try {
      return siteDomain(new URL(raw).hostname) === siteDomain(base.hostname);
    } catch {
      return false;
    }
  };
  while (sitemapQueue.length && triedSitemaps.size < MAX_SITEMAPS) {
    const url = sitemapQueue.shift()!;
    // Only the business's own sitemaps (robots.txt or a sitemap index could point anywhere).
    if (triedSitemaps.has(url) || !ownSite(url)) continue;
    triedSitemaps.add(url);
    const file = await quietly(url);
    if (!file || !/xml|text\/plain/.test(mediaType(file))) continue;
    for (const loc of sitemapLocs(file.body.toString("utf8"))) {
      if (/\.xml(\.gz)?$/i.test(loc)) sitemapQueue.push(loc);
      else {
        const ok = candidateUrl(loc, base, scope);
        if (ok) fromSitemaps.push(ok);
      }
    }
  }

  const { data: rows } = await db.from("business_sources").select("url, origin, content, content_hash, title").eq("agent_id", agentId);
  const existing = new Map<string, Existing>((rows ?? []).map((r) => [r.url, r]));

  const seen = new Set<string>([homeUrl]);
  let queue: string[] = [];
  const enqueue = (urls: string[]) => {
    for (const u of urls) if (!seen.has(u) && !queue.includes(u) && robotsAllows(rules, new URL(u).pathname)) queue.push(u);
    queue = rankUrls(queue, homeUrl).filter((u) => u !== homeUrl);
  };

  const pages: PageText[] = [];
  const progress: { title: string; url: string }[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  let pdfs = 0;
  const now = new Date().toISOString();

  const readPage = async (url: string, fetched: Fetched | null) => {
    const file = fetched ?? (await quietly(url));
    if (!file) return { links: [] as string[], ok: false };
    const type = mediaType(file);
    let text = "";
    let title = "";
    let kind: "page" | "pdf" = "page";
    let links: string[] = [];
    if (type === "text/html" || type === "application/xhtml+xml") {
      const html = file.body.toString("utf8");
      text = htmlToText(html);
      title = pageTitle(html) ?? shortUrl(url);
      links = linksOnPage(html, base, scope);
    } else if (type === "application/pdf" && pdfs < MAX_SITE_PDFS) {
      pdfs++;
      kind = "pdf";
      title = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "PDF");
      text = await readWithAi(file.body, type, "pdf").catch(() => "");
    } else {
      return { links, ok: false };
    }
    text = text.replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_PAGE_TEXT);
    if (text.length < 40 && url !== homeUrl) return { links, ok: false };
    pages.push({ url, title, text });
    progress.push({ title: title.slice(0, 80), url });
    const before = existing.get(url);
    // A link the business added itself keeps being read on its own.
    if (before?.origin === "link") return { links, ok: true };
    const h = hash(text);
    if (before && before.content_hash === h) {
      await db.from("business_sources").update({ last_read_at: now, status: "ok", error: null }).eq("agent_id", agentId).eq("url", url);
    } else {
      if (before?.content) {
        const diff = changedLines(before.content, text);
        added.push(...diff.added);
        removed.push(...diff.removed);
      } else if (before === undefined && reason !== "first" && previous.summary) {
        added.push(`A new page: ${title}`);
      }
      await db.from("business_sources").upsert(
        { agent_id: agentId, url, origin: "site", visibility: "public", status: "ok", kind, content: text, title: title.slice(0, 200), content_hash: h, error: null, last_read_at: now },
        { onConflict: "agent_id,url" },
      );
    }
    return { links, ok: true };
  };

  const report = async () => {
    await db
      .from("business_sites")
      .update({ pages_read: pages.length, pages_found: Math.min(MAX_SITE_PAGES, pages.length + queue.length), progress: asJson(progress.slice(-40)) })
      .eq("agent_id", agentId);
  };

  enqueue(fromSitemaps);
  const first = await readPage(homeUrl, home);
  enqueue(first.links);
  await report();
  while (queue.length && pages.length < MAX_SITE_PAGES) {
    const batch = queue.splice(0, Math.min(CONCURRENCY, MAX_SITE_PAGES - pages.length));
    batch.forEach((u) => seen.add(u));
    const results = await Promise.all(batch.map((u) => readPage(u, null)));
    enqueue(results.flatMap((r) => r.links));
    await report();
  }

  // Pages no longer on the website go (a page that just failed to load this time stays).
  const gone = (rows ?? []).filter((r) => r.origin === "site" && !seen.has(r.url));
  if (gone.length) {
    await db.from("business_sources").delete().eq("agent_id", agentId).eq("origin", "site").in("url", gone.map((r) => r.url));
    if (reason !== "first") removed.push(...gone.map((r) => `The page “${r.title ?? shortUrl(r.url)}”`));
  }

  const total = pages.reduce((n, p) => n + p.text.length, 0);
  const warning = total < THIN_SITE_CHARS ? THIN_SITE_WARNING : null;
  const changed = added.length > 0 || removed.length > 0;

  // Learn (again) on a first read, on "Re-read now", or when the website changed.
  let learned = previous;
  let learnWarning: string | null = null;
  if (reason !== "refresh" || changed || !previous.summary) {
    try {
      learned = await learnFrom(pages);
    } catch {
      learnWarning = "Your agent read the pages but couldn't summarise them just now. It still answers from the pages; try Re-read now later.";
    }
  }

  // Once live: tell the owner what changed (the agent already answers from the new text).
  if (liveAt && changed && reason !== "first") await tellChanges(ownerId, added, removed);

  await db
    .from("business_sites")
    .update({
      status: "ready",
      pages_read: pages.length,
      pages_found: pages.length,
      progress: asJson(progress.slice(-40)),
      learned: asJson(learned),
      warning: warning ?? learnWarning,
      error: null,
      last_read_at: new Date().toISOString(),
      reading_started_at: null,
    })
    .eq("agent_id", agentId);

  // Last, once the owner can already review: the address index (the newest pages the site lists), so pages
  // this scan didn't read can be found when asked about. On a very big site this takes a minute or two.
  await indexSite(agentId, homeUrl, [...seen, ...queue]).catch(() => 0);
}

/** The basics, facts and likely questions, from the key pages first. */
async function learnFrom(pages: PageText[]): Promise<Learned> {
  const used: PageText[] = [];
  let size = 0;
  for (const p of pages) {
    if (size + p.text.length > LEARN_BUDGET) continue;
    used.push(p);
    size += p.text.length;
  }
  if (!used.length) return clampLearned({ summary: "", hours: "", address: "", phone: "", email: "", facts: [], faqs: [] }, []);
  const text = used.map((p) => `Page: ${p.url}\nTitle: ${p.title}\n${p.text}`).join("\n\n---\n\n");
  const draft = await llm().generateObject({
    purpose: "business_learn",
    tier: "smart",
    system: SITE_LEARN_SYSTEM,
    messages: [{ role: "user", content: wrapUntrusted("website", text) }],
    schema: LearnedDraftSchema,
    maxTokens: 4000,
    mockContext: { pages: used },
  });
  return clampLearned(draft, used.map((p) => p.url));
}

/** "🌐 Your website now says … Your agent has updated." (up to three, most important first). */
async function tellChanges(ownerId: string, added: string[], removed: string[]) {
  const list = (lines: string[]) => lines.slice(0, 30).map((l) => `+ ${l}`).join("\n");
  const summary = await llm()
    .generateText({
      purpose: "business_changes",
      tier: "fast",
      system: SITE_CHANGES_SYSTEM,
      messages: [{ role: "user", content: wrapUntrusted("changes", `Added:\n${list(added)}\n\nRemoved:\n${list(removed).replaceAll("+ ", "- ")}`) }],
      maxTokens: 300,
      mockContext: { added, removed },
    })
    .catch(() => "");
  const lines = summary
    .split("\n")
    .map((l) => l.replace(/^[-*•\d.\s]+/, "").trim())
    .filter((l) => l && l.toUpperCase() !== "NONE")
    .slice(0, 3);
  for (const line of lines) await notify([ownerId], "business", `🌐 ${line.slice(0, 250)} Your agent has updated.`, "/business", { kind: "site_change" });
}

/** The daily check (called by the sweeper): one live website at a time, plus tidying interrupted reads. */
export async function refreshDueSites(limit = 1) {
  const db = adminClient();
  const stuck = new Date(Date.now() - STUCK_MINUTES * 60_000).toISOString();
  await db
    .from("business_sites")
    .update({ status: "error", error: "Reading was interrupted. Tap Re-read now to try again.", reading_started_at: null })
    .eq("status", "reading")
    .lt("reading_started_at", stuck);
  const cutoff = new Date(Date.now() - SITE_REFRESH_HOURS * 3600_000).toISOString();
  const { data } = await db
    .from("business_sites")
    .select("agent_id")
    .not("live_at", "is", null)
    .is("reading_started_at", null)
    .lt("last_read_at", cutoff)
    .order("last_read_at")
    .limit(limit);
  for (const s of data ?? []) await readWebsite(s.agent_id, "refresh");
}

/** Open customer questions a business agent couldn't answer, grouped by topic (newest first). */
export async function openBusinessQuestions(agentId: string, sinceDays = 30) {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const { data } = await adminClient()
    .from("inbox_items")
    .select("id, payload, created_at")
    .eq("agent_id", agentId)
    .eq("kind", "question")
    .eq("status", "open")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(300);
  const asked = (data ?? []).flatMap((i) => {
    const p = (i.payload ?? {}) as { business?: boolean; question?: string };
    return p.business && p.question ? [{ id: i.id, question: p.question, created_at: i.created_at }] : [];
  });
  return groupQuestions(asked);
}

/** Once a week: "6 customers asked about parking this week. Your website doesn't say." (when 2+ asked the same). */
export async function nudgeBusinessGaps() {
  const db = adminClient();
  const week = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data } = await db
    .from("inbox_items")
    .select("agent_id, owner_id, payload")
    .eq("kind", "question")
    .eq("status", "open")
    .gte("created_at", week)
    .limit(2000);
  const businesses = new Map<string, string>();
  for (const i of data ?? []) if ((i.payload as { business?: boolean } | null)?.business) businesses.set(i.agent_id, i.owner_id);
  for (const [agentId, ownerId] of businesses) {
    const top = (await openBusinessQuestions(agentId, 7)).find((g) => g.items.length >= 2 && g.topic);
    if (!top) continue;
    const { count } = await db
      .from("notices")
      .select("id", { count: "exact", head: true })
      .eq("user_id", ownerId)
      .eq("area", "business")
      .eq("kind", "site_gap")
      .gte("created_at", week);
    if (count) continue;
    await notify(
      [ownerId],
      "business",
      `❓ ${top.items.length} customers asked about ${top.topic} this week, and your website doesn't say. Answer once and they all get it.`,
      "/business",
      { kind: "site_gap", needsAction: true },
    );
  }
}
