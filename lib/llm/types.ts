import type { z } from "zod";

/**
 * Why the call is being made. Lets the mock provider produce deterministic,
 * purpose-specific output, and gives logs/cost tracking a stable label.
 */
export type LLMPurpose =
  | "intent" // parse an owner's request into a coordination task (legacy single-block)
  | "compose" // compose a plan from building blocks
  | "chat_assist" // @agent in a chat: summarise, translate, draft, answer (private to the owner)
  | "coordination_reply" // answer another agent's availability/preference request
  | "proposal" // turn collected replies into a plan
  | "owner_chat" // talk to the agent's own owner
  | "business_faq" // answer a question from business-provided info only
  | "ask_around_summary" // summarise friends' recommendations for the owner
  | "business_ingest" // read a business's PDF or photo (e.g. a menu) into text
  | "business_learn" // learn a business's whole website: basics, facts, questions & answers
  | "business_changes" // say what changed on a business's website since the last read
  | "moderation" // check a community message against the community's rules
  | "route" // is this a request to research public facts, or ordinary chat?
  | "research" // look something up on the public web, with sources
  | "find" // search for pages that may answer a question (addresses only, no answer)
  | "pick"; // choose which of the pages found to read

export type LLMTier = "smart" | "fast";

export type LLMMessage = { role: "user" | "assistant"; content: string };

export interface LLMRequest {
  purpose: LLMPurpose;
  tier?: LLMTier;
  system: string;
  messages: LLMMessage[];
  maxTokens?: number;
  /** Files sent with the last user message (a PDF menu, a photo of a menu). */
  attachments?: { mediaType: string; base64: string }[];
  /**
   * Structured context the mock provider uses instead of reading prose.
   * Must contain nothing beyond what is already in `system`/`messages`.
   */
  mockContext?: unknown;
}

export interface LLMObjectRequest<T> extends LLMRequest {
  schema: z.ZodType<T>;
}

/** Public web research: only the question goes out (never chat history or profile data). */
export interface LLMResearchRequest {
  system: string;
  question: string;
  /** Only these sites (a business's own domain); otherwise the whole web. */
  allowedDomains?: string[];
  /** Pages that may hold the answer (e.g. from a business's address index). */
  seedUrls?: string[];
  maxSearches?: number;
  maxFetches?: number;
  /** A place named in the question, to localise results. */
  place?: string;
  /** Current information (weather, today): don't use cached copies of pages. */
  fresh?: boolean;
}

export interface LLMResearchResult {
  /** The final text, after the last search or fetch. */
  text: string;
  sources: { url: string; title: string; quote?: string; retrievedAt?: string; pageAge?: string }[];
  /** Text that was actually read (quotes and fetched pages), to check facts against. */
  evidence: string[];
  errors: string[];
  /** Pages opened and read in full (0 = the answer rests on search snippets only). */
  pagesRead: number;
}

export interface LLMFindRequest {
  question: string;
  /** Only these sites (a business's own domain); otherwise the whole web. */
  allowedDomains?: string[];
  maxSearches?: number;
}

export interface LLMFindResult {
  /** Pages the search returned, best first. Addresses and titles only: nothing is opened or answered. */
  pages: { url: string; title: string; pageAge?: string }[];
  errors: string[];
}

export interface LLMProvider {
  readonly name: string;
  research(req: LLMResearchRequest): Promise<LLMResearchResult>;
  /** A cheap search: which pages might answer this? (The app reads them itself.) */
  findPages(req: LLMFindRequest): Promise<LLMFindResult>;
  generateText(req: LLMRequest): Promise<string>;
  generateObject<T>(req: LLMObjectRequest<T>): Promise<T>;
}

export class LLMError extends Error {
  constructor(message: string, readonly kind: "refusal" | "invalid_output" | "api") {
    super(message);
    this.name = "LLMError";
  }
}
