import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { recordUsage } from "@/lib/usage/meter";
import { LLMError, type LLMObjectRequest, type LLMProvider, type LLMPurpose, type LLMRequest, type LLMResearchRequest, type LLMResearchResult, type LLMTier } from "./types";

const RESEARCH_DEADLINE_MS = 120_000;

// Main reasoning model, plus a cheaper worker for simple parsing.
// Both are overridable per deployment.
const MODELS: Record<LLMTier, string> = {
  smart: process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5",
  fast: process.env.ANTHROPIC_FAST_MODEL ?? "claude-haiku-5-5",
};

// Server-side refusal fallback is available for the Opus/Sonnet/Fable tiers,
// not Haiku.
function supportsServerFallback(model: string) {
  return !model.startsWith("claude-haiku");
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private readonly client = new Anthropic({ timeout: 60_000, maxRetries: 2 });

  private base(req: LLMRequest) {
    const model = MODELS[req.tier ?? "smart"];
    const fallback = supportsServerFallback(model);
    return {
      model,
      max_tokens: req.maxTokens ?? 4000,
      system: req.system,
      messages: withAttachments(req),
      // Short, bounded tasks: low effort keeps latency and cost down.
      output_config: { effort: "low" as const },
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    };
  }

  /**
   * Public web research with Anthropic's server tools: search to find pages,
   * fetch to read them. Called directly (no dynamic filtering) so every claim
   * comes back with its citation. Bounded: a few searches and fetches, a
   * capped page size, and an overall deadline.
   */
  async research(req: LLMResearchRequest): Promise<LLMResearchResult> {
    const model = MODELS.smart;
    const domains = req.allowedDomains?.length ? { allowed_domains: req.allowedDomains } : {};
    const tools: Anthropic.Beta.BetaToolUnion[] = [
      {
        type: "web_search_20260318",
        name: "web_search",
        max_uses: req.maxSearches ?? 3,
        allowed_callers: ["direct"],
        ...domains,
        ...(req.place ? { user_location: { type: "approximate" as const, city: req.place } } : {}),
      },
      {
        type: "web_fetch_20260318",
        name: "web_fetch",
        max_uses: req.maxFetches ?? 3,
        allowed_callers: ["direct"],
        citations: { enabled: true },
        max_content_tokens: 12_000,
        ...domains,
        ...(req.fresh ? { use_cache: false } : {}),
      },
    ];
    // Fetch only reads addresses that appear in the conversation: seed pages go in the user message.
    const seeds = req.seedUrls?.length ? `\n\nPages that may hold the answer:\n${req.seedUrls.join("\n")}` : "";
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: `${req.question}${seeds}` }];
    const blocks: Anthropic.Beta.BetaContentBlock[] = [];
    const deadline = Date.now() + RESEARCH_DEADLINE_MS;
    try {
      // A long search turn can pause; sending it back unchanged resumes it.
      for (let turn = 0; turn < 4; turn++) {
        const response = await this.client.beta.messages.create(
          {
            model,
            max_tokens: 3000,
            system: req.system,
            messages,
            tools,
            output_config: { effort: "medium" },
            ...(supportsServerFallback(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
          },
          { timeout: 90_000, maxRetries: 1 },
        );
        await meter({ purpose: "research" }, response);
        if (response.stop_reason === "refusal") throw new LLMError("The model declined this request.", "refusal");
        blocks.push(...response.content);
        if (response.stop_reason !== "pause_turn" || Date.now() > deadline) break;
        messages.push({ role: "assistant", content: response.content as Anthropic.Beta.BetaContentBlockParam[] });
      }
    } catch (error) {
      throw wrap(error);
    }
    return readResearch(blocks);
  }

  async generateText(req: LLMRequest): Promise<string> {
    try {
      const response = await this.client.beta.messages.create(this.base(req));
      await meter(req, response);
      if (response.stop_reason === "refusal") {
        throw new LLMError("The model declined this request.", "refusal");
      }
      return response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
    } catch (error) {
      throw wrap(error);
    }
  }

  async generateObject<T>(req: LLMObjectRequest<T>): Promise<T> {
    try {
      const base = this.base(req);
      const response = await this.client.beta.messages.parse({
        ...base,
        output_config: { ...base.output_config, format: betaZodOutputFormat(req.schema) },
      });
      await meter(req, response);
      if (response.stop_reason === "refusal") {
        throw new LLMError("The model declined this request.", "refusal");
      }
      const parsed = req.schema.safeParse(response.parsed_output);
      if (!parsed.success) throw new LLMError("Model output did not match schema.", "invalid_output");
      return parsed.data;
    } catch (error) {
      throw wrap(error);
    }
  }
}

/**
 * Reads a research turn: the answer is the text after the last search or
 * fetch; sources come from citations and fetched pages; tool errors arrive
 * as ordinary blocks (HTTP 200), so each result is checked.
 */
export function readResearch(blocks: Anthropic.Beta.BetaContentBlock[]): LLMResearchResult {
  const sources = new Map<string, LLMResearchResult["sources"][number]>();
  const evidence: string[] = [];
  const errors: string[] = [];
  const pageAge = new Map<string, string>();
  const add = (url: string, patch: Partial<LLMResearchResult["sources"][number]>) => {
    const current = sources.get(url) ?? { url, title: "" };
    sources.set(url, { ...current, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v)) });
  };
  let lastTool = -1;
  let pagesRead = 0;
  blocks.forEach((b, i) => {
    if (b.type === "web_search_tool_result") {
      lastTool = i;
      if (Array.isArray(b.content)) {
        for (const r of b.content) if (r.page_age) pageAge.set(r.url, r.page_age);
      } else errors.push(`search: ${(b.content as { error_code?: string }).error_code ?? "error"}`);
    } else if (b.type === "web_fetch_tool_result") {
      lastTool = i;
      if (b.content.type === "web_fetch_result") {
        const doc = b.content.content;
        add(b.content.url, { title: doc.title ?? "", retrievedAt: b.content.retrieved_at ?? undefined });
        if (doc.source.type === "text") evidence.push(doc.source.data);
        pagesRead++;
      } else errors.push(`fetch: ${b.content.error_code}`);
    } else if (b.type === "server_tool_use") lastTool = i;
  });
  let text = "";
  blocks.forEach((b, i) => {
    if (b.type !== "text") return;
    for (const c of b.citations ?? []) {
      evidence.push(c.cited_text);
      if (c.type === "web_search_result_location") add(c.url, { title: c.title ?? "", quote: c.cited_text, pageAge: pageAge.get(c.url) });
    }
    if (i > lastTool) text += b.text;
  });
  return { text: text.trim(), sources: [...sources.values()], evidence, errors, pagesRead };
}

/** Puts PDFs/images in front of the text of the last user message. */
function withAttachments(req: LLMRequest): Anthropic.Beta.BetaMessageParam[] {
  if (!req.attachments?.length) return req.messages;
  const files = req.attachments.map((f) =>
    f.mediaType === "application/pdf"
      ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.base64 } } as const)
      : ({ type: "image", source: { type: "base64", media_type: f.mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp", data: f.base64 } } as const),
  );
  return req.messages.map((m, i) =>
    i === req.messages.length - 1 && m.role === "user" ? { role: "user", content: [...files, { type: "text", text: m.content }] } : m,
  );
}

/**
 * Records what a call cost. With a server-side fallback, one call can be served
 * by more than one model; usage.iterations then breaks tokens down per model.
 */
async function meter(
  req: { purpose: LLMPurpose },
  response: { model: string; usage: Anthropic.Beta.BetaUsage; stop_reason: string | null },
) {
  const ok = response.stop_reason !== "refusal";
  type Entry = { model: string; input: number; output: number; cacheRead: number; cacheWrite: number };
  const parts: Entry[] = [];
  for (const raw of response.usage.iterations ?? []) {
    const i = raw as unknown as Partial<Record<string, unknown>>;
    if (typeof i.input_tokens !== "number" || typeof i.output_tokens !== "number") continue;
    parts.push({
      model: typeof i.model === "string" && i.model ? i.model : response.model,
      input: i.input_tokens,
      output: i.output_tokens,
      cacheRead: typeof i.cache_read_input_tokens === "number" ? i.cache_read_input_tokens : 0,
      cacheWrite: typeof i.cache_creation_input_tokens === "number" ? i.cache_creation_input_tokens : 0,
    });
  }
  const entries: Entry[] = parts.length
    ? parts
    : [
        {
          model: response.model,
          input: response.usage.input_tokens,
          output: response.usage.output_tokens,
          cacheRead: response.usage.cache_read_input_tokens ?? 0,
          cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
        },
      ];
  for (const e of entries) {
    await recordUsage({
      purpose: req.purpose,
      provider: "anthropic",
      model: e.model,
      inputTokens: e.input,
      outputTokens: e.output,
      cacheReadTokens: e.cacheRead,
      cacheWriteTokens: e.cacheWrite,
      ok,
    });
  }
}

function wrap(error: unknown): LLMError {
  if (error instanceof LLMError) return error;
  if (error instanceof Anthropic.AuthenticationError) {
    return new LLMError("Anthropic API key missing or invalid (set ANTHROPIC_API_KEY or LLM_PROVIDER=mock).", "api");
  }
  if (error instanceof Anthropic.RateLimitError) return new LLMError("AI provider is rate limiting; try again shortly.", "api");
  if (error instanceof Anthropic.APIError) return new LLMError(`AI provider error ${error.status ?? ""}`.trim(), "api");
  return new LLMError(error instanceof Error ? error.message : "Unknown AI provider error", "api");
}
