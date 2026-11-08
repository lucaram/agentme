import { llm } from "@/lib/llm";
import { canContact, type ContactPolicy, type Relationship } from "@/lib/policy/contactPolicy";
import { isRequestableCategory, selectDisclosableFacts, type Fact, type RequestableCategory } from "@/lib/policy/disclosure";
import {
  AskAroundRequestSchema,
  CoordinationReplySchema,
  CoordinationRequestSchema,
  QuestionRequestSchema,
  type CoordinationReply,
} from "@/lib/coordination/schemas";
import { BUSINESS_FAQ_SYSTEM, COORDINATION_REPLY_SYSTEM, wrapUntrusted } from "./prompts";
import { matchTips } from "@/lib/people/askAround";

export type Tip = { topic: string; tip: string };

export type RecipientAgent = {
  id: string;
  handle: string;
  type: "personal" | "business";
  contact_policy: ContactPolicy;
  display_name: string;
  business_info: unknown;
  /** "Friends can ask me for recommendations" (Settings). */
  recommendations_ok?: boolean;
};

export type IncomingA2A = {
  /** Calling agent's handle, or null for an anonymous/external caller. */
  callerHandle: string | null;
  relationship: Relationship;
  text: string;
  data: unknown;
};

export type AgentResponse =
  | { status: "completed"; text: string; data?: Record<string, unknown>; disclosed: string[]; skill: string }
  | { status: "refused"; text: string; reason: string; disclosed: []; skill: string }
  | {
      /** The agent may not answer this by itself: its owner is asked via the inbox. */
      status: "needs_human";
      text: string;
      skill: string;
      disclosed: [];
      inbox: InboxRequest;
    };

/** What lands in the owner's inbox. */
export type InboxRequest =
  | {
      kind: "info_request";
      event: string;
      window: string;
      categories: string[];
      /** Requested categories the agent has no permission (or no data) to share. */
      missing: RequestableCategory[];
      /** Requested categories it could share automatically, for the owner to review. */
      shareable: Partial<Record<RequestableCategory, string>>;
    }
  | { kind: "question"; question: string; ask_around?: boolean };

/** Categories without which a coordination reply is useless; if not shareable, ask the human. */
const ESSENTIAL: readonly RequestableCategory[] = ["availability"];

const refuse = (skill: string, reason: string, text: string): AgentResponse => ({
  status: "refused",
  skill,
  reason,
  text,
  disclosed: [],
});

/**
 * How an AGENTME agent answers another agent. Every trust rule is applied here
 * in code, BEFORE any model call:
 *   1. the recipient's contact policy,
 *   2. data minimisation (only shareable facts in requested categories),
 *   3. schema validation and category stripping on the way out.
 */
export async function respondAsAgent(
  recipient: RecipientAgent,
  incoming: IncomingA2A,
  facts: readonly Fact[],
  tips: readonly Tip[] = [],
): Promise<AgentResponse> {
  const isCoordination = CoordinationRequestSchema.safeParse(incoming.data);
  const isQuestion = QuestionRequestSchema.safeParse(incoming.data);
  const isAskAround = AskAroundRequestSchema.safeParse(incoming.data);
  const skill = isAskAround.success && recipient.type === "personal"
    ? "coordination.ask_around"
    : isCoordination.success
    ? "coordination.availability"
    : isQuestion.success
      ? recipient.type === "business" ? "business.faq" : "coordination.question"
      : recipient.type === "business" ? "business.faq" : "unknown";

  // Anonymous callers may only reach public business info on agents that accept anyone.
  if (incoming.callerHandle === null && !(recipient.type === "business" && skill === "business.faq")) {
    return refuse(skill, "authentication_required", "This agent only talks to authenticated AGENTME agents.");
  }

  const decision = canContact(recipient.contact_policy, incoming.relationship);
  if (!decision.allowed) {
    return refuse(skill, decision.reason, "This agent doesn't accept requests from you.");
  }

  if (recipient.type === "business") {
    return answerBusinessQuestion(recipient, isQuestion.success ? isQuestion.data.question : incoming.text);
  }

  // Ask around: only contacts, only if the person allows it. A saved tip on the
  // topic is shared by the agent itself; otherwise the person decides.
  if (isAskAround.success) {
    if (incoming.relationship !== "accepted") return refuse(skill, "not_a_contact", "Only contacts can ask around.");
    if (recipient.recommendations_ok === false) return refuse(skill, "not_taking_requests", "Not taking recommendation requests.");
    const matching = matchTips(isAskAround.data.question, [...tips]).slice(0, 3);
    if (matching.length) {
      const answer = matching.map((t) => t.tip).join(" · ");
      return {
        status: "completed",
        skill,
        text: answer,
        data: { type: "agentme.ask_around.answer", answer, from: "saved_tip" },
        disclosed: ["saved_tip"],
      };
    }
    return {
      status: "needs_human",
      skill,
      text: "I've passed it on; they'll answer if they have a tip.",
      disclosed: [],
      inbox: { kind: "question", question: isAskAround.data.question, ask_around: true },
    };
  }

  // Free questions are always answered by the person, never guessed by their
  // agent, and only contacts may ask (so nobody's inbox can be spammed).
  if (isQuestion.success) {
    if (incoming.relationship !== "accepted") {
      return refuse(skill, "not_a_contact", "Only contacts can ask questions.");
    }
    return {
      status: "needs_human",
      skill,
      text: "I've passed your question on; they'll answer personally.",
      disclosed: [],
      inbox: { kind: "question", question: isQuestion.data.question },
    };
  }

  if (!isCoordination.success) {
    return refuse(skill, "unsupported_request", "This agent only accepts structured coordination requests from contacts.");
  }
  const request = isCoordination.data;

  // (2) Data minimisation — the model only ever sees these facts.
  const shareable = selectDisclosableFacts(facts, request.categories, incoming.relationship);
  const allowed = Object.fromEntries(shareable.map((f) => [f.category, f.value])) as Partial<
    Record<RequestableCategory, string>
  >;

  // "Ask my human": an accepted contact needs something essential that this agent
  // isn't allowed to share. Hand it to the owner instead of guessing or going
  // silent. Only contacts can reach the inbox, so strangers can't spam it, and
  // no model runs (nothing is shared) until the owner decides.
  const requested = request.categories.filter(isRequestableCategory);
  const missingEssential = ESSENTIAL.filter((c) => requested.includes(c) && !allowed[c]);
  if (incoming.relationship === "accepted" && missingEssential.length) {
    return {
      status: "needs_human",
      skill,
      text: `I've asked my owner directly; I'll reply once they answer.`,
      disclosed: [],
      inbox: {
        kind: "info_request",
        event: request.event,
        window: request.window,
        categories: request.categories,
        missing: requested.filter((c) => !allowed[c]),
        shareable: allowed,
      },
    };
  }

  const factsBlock = shareable.length
    ? shareable.map((f) => `- ${f.category}: ${f.value}`).join("\n")
    : "(none — your owner has not shared anything for this request)";
  const requestBlock = wrapUntrusted(
    "untrusted_request",
    JSON.stringify({ from: `@${incoming.callerHandle}`, event: request.event, window: request.window, asks_for: request.categories, note: request.note ?? null }),
  );

  const reply = await llm().generateObject({
    purpose: "coordination_reply",
    tier: "fast",
    system: COORDINATION_REPLY_SYSTEM,
    messages: [{ role: "user", content: `<shareable_facts>\n${factsBlock}\n</shareable_facts>\n\n${requestBlock}` }],
    schema: CoordinationReplySchema,
    maxTokens: 1000,
    mockContext: { facts: allowed, window: request.window },
  });

  // (3) Strip anything outside the authorised categories, whatever the model said.
  const safe: CoordinationReply = {
    availability: allowed.availability ? reply.availability : null,
    food: allowed.food ? reply.food : null,
    location: allowed.location ? reply.location : null,
    summary: reply.summary,
  };

  return {
    status: "completed",
    skill,
    text: safe.summary,
    data: { type: "agentme.coordination.reply", ...safe },
    disclosed: shareable.map((f) => f.category),
  };
}

type BusinessInfo = { description?: string; hours?: string; faqs?: { q: string; a: string }[] };

async function answerBusinessQuestion(recipient: RecipientAgent, question: string): Promise<AgentResponse> {
  const info = (recipient.business_info ?? {}) as BusinessInfo;
  const trimmed = question.trim().slice(0, 1000);
  if (!trimmed) return refuse("business.faq", "empty_question", "Please ask a question.");

  const infoBlock = [
    `Business: ${recipient.display_name} (@${recipient.handle})`,
    info.description && `About: ${info.description}`,
    info.hours && `Opening hours: ${info.hours}`,
    ...(info.faqs ?? []).map((f) => `Q: ${f.q}\nA: ${f.a}`),
  ]
    .filter(Boolean)
    .join("\n");

  const text = await llm().generateText({
    purpose: "business_faq",
    tier: "fast",
    system: BUSINESS_FAQ_SYSTEM,
    messages: [
      { role: "user", content: `<business_info>\n${infoBlock}\n</business_info>\n\n${wrapUntrusted("untrusted_question", trimmed)}` },
    ],
    maxTokens: 600,
    mockContext: { question: trimmed, businessInfo: info },
  });

  return { status: "completed", skill: "business.faq", text, disclosed: ["business_info"] };
}
