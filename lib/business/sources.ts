import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { llm } from "@/lib/llm";
import { withUsageContext } from "@/lib/usage/context";
import { BUSINESS_INGEST_SYSTEM } from "@/lib/agents/prompts";
import type { KnowledgeSource } from "./knowledge";
import { htmlToText } from "./extract";
import { safeFetch } from "./fetch";

const MAX_CONTENT = 30_000;
const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024; // keeps the encoded image under the model's limit
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export const REFRESH_HOURS = 24;

/** PDFs and photos (e.g. a menu) are read by the AI into plain text. */
async function readWithAi(body: Buffer, mediaType: string, kind: "pdf" | "image") {
  return llm().generateText({
    purpose: "business_ingest",
    tier: "fast",
    system: BUSINESS_INGEST_SYSTEM,
    messages: [{ role: "user", content: "Write out everything in this file that a customer might ask about." }],
    attachments: [{ mediaType, base64: body.toString("base64") }],
    maxTokens: 4000,
    mockContext: { kind, hint: "Menu: Margherita £9, Tiramisù £6" },
  });
}

/** Fetches one link and stores what was read (or why it couldn't be read). */
export async function readSource(sourceId: string) {
  const db = adminClient();
  const { data: source } = await db.from("business_sources").select("id, url, agent_id").eq("id", sourceId).maybeSingle();
  if (!source) return;
  const { data: owner } = await db.from("agents").select("owner_id").eq("id", source.agent_id).single();
  await db.from("business_sources").update({ status: "reading" }).eq("id", source.id);
  try {
    const fetched = await safeFetch(source.url);
    const type = fetched.contentType.split(";")[0].trim();
    let kind: "page" | "pdf" | "image" | "text";
    let content: string;
    if (type === "text/html" || type === "application/xhtml+xml") {
      kind = "page";
      content = htmlToText(fetched.body.toString("utf8"));
    } else if (type === "text/plain" || type === "text/markdown") {
      kind = "text";
      content = fetched.body.toString("utf8");
    } else if (type === "application/pdf") {
      kind = "pdf";
      content = await withUsageContext({ agentId: source.agent_id, userId: owner?.owner_id ?? null }, () => readWithAi(fetched.body, type, "pdf"));
    } else if (IMAGE_TYPES.includes(type)) {
      if (fetched.body.length > MAX_IMAGE_BYTES) throw new Error("That photo is too big (over 3.5 MB).");
      kind = "image";
      content = await withUsageContext({ agentId: source.agent_id, userId: owner?.owner_id ?? null }, () => readWithAi(fetched.body, type, "image"));
    } else {
      throw new Error("This kind of file can't be read. Use a web page, a PDF or a photo.");
    }
    content = content.replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_CONTENT);
    if (!content) throw new Error("Nothing readable was found there.");
    await db.from("business_sources").update({ status: "ok", kind, content, error: null, last_read_at: new Date().toISOString() }).eq("id", source.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn't read it.";
    await db.from("business_sources").update({ status: "error", error: message.slice(0, 300), last_read_at: new Date().toISOString() }).eq("id", source.id);
  }
}

/** Keeps knowledge fresh: re-reads a few links not read in the last day (called by the sweeper). */
export async function refreshDueSources(limit = 3) {
  const cutoff = new Date(Date.now() - REFRESH_HOURS * 3600_000).toISOString();
  const { data } = await adminClient().from("business_sources").select("id").in("status", ["ok", "error"]).lt("last_read_at", cutoff).order("last_read_at").limit(limit);
  for (const s of data ?? []) await readSource(s.id);
}

export async function businessSources(agentId: string): Promise<KnowledgeSource[]> {
  const { data } = await adminClient().from("business_sources").select("url, visibility, content, last_read_at").eq("agent_id", agentId).eq("status", "ok");
  return data ?? [];
}
