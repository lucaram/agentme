import { wrapUntrusted } from "@/lib/agents/prompts";

/** What a business agent knows: pure (no server code), shared by the answering code and My Business. */

type BusinessInfo = { about?: string; customers?: string; description?: string; hours?: string; faqs?: { q: string; a: string }[] };
export type KnowledgeSource = { url: string; visibility: string; content: string | null; last_read_at: string | null };


const MAX_KNOWLEDGE = 40_000;

/**
 * What a business agent may answer from, for this audience. "customers" adds
 * the customers-only text and links (the business's contacts). The owner's own
 * words are one block; website text is another, marked as untrusted data.
 */
export function businessKnowledge(
  agent: { display_name: string; handle: string; business_info: unknown },
  sources: KnowledgeSource[],
  audience: "public" | "customers",
): { info: string; websites: string } {
  const info = (agent.business_info ?? {}) as BusinessInfo;
  const about = info.about?.trim() || [info.description, info.hours && `Opening hours: ${info.hours}`].filter(Boolean).join("\n");
  const own = [
    `Business: ${agent.display_name} (@${agent.handle})`,
    about,
    ...(info.faqs ?? []).map((f) => `Q: ${f.q}\nA: ${f.a}`),
    audience === "customers" && info.customers?.trim() ? `For customers:\n${info.customers.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const visible = sources.filter((s) => s.content && (s.visibility === "public" || audience === "customers"));
  const pages = visible.map((s) => `From ${s.url} (read ${s.last_read_at?.slice(0, 10) ?? "recently"}):\n${s.content}`).join("\n\n");
  return { info: own.slice(0, MAX_KNOWLEDGE), websites: pages ? wrapUntrusted("website_content", pages.slice(0, MAX_KNOWLEDGE)) : "" };
}
