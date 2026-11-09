import { z } from "zod";
import { REQUESTABLE_CATEGORIES } from "@/lib/policy/disclosure";

export const INTENT_KINDS = ["coordinate", "rsvp", "poll", "question", "assign", "announce", "chat"] as const;
export type IntentKind = (typeof INTENT_KINDS)[number];

export const IntentSchema = z.object({
  kind: z
    .enum(INTENT_KINDS)
    .describe(
      "coordinate = organise a meeting/event and find a time that suits everyone; rsvp = invite them to an event whose day AND time the owner already fixed, and ask who's in; poll = ask them to choose between options; question = ask them something and collect their answers; assign = a sign-up list of items/roles people claim (who brings what); announce = just tell them something, no reply needed; chat = anything else.",
    ),
  event: z.string().max(60).describe('Short event name, e.g. "dinner", "coffee", "call". Empty if not an event.'),
  window: z.string().max(80).describe('When, in the owner\'s words, e.g. "Saturday evening". Empty if not stated.'),
  participants: z.array(z.string()).describe("Handles mentioned with @, without the @."),
  categories: z
    .array(z.enum(REQUESTABLE_CATEGORIES))
    .describe(
      "coordinate only: which kinds of information the agent needs from the other agents. availability (when they're free), food (dinners, lunches, drinks), location (where they usually are, to pick a place nearby), interests (choosing an activity), practical (needs like step-free access, kids, no car), budget (choosing a place by price). Ask only for what the plan needs.",
    ),
  question: z
    .string()
    .max(500)
    .describe("poll: the question to vote on. question: what to ask, addressed to the recipient (e.g. 'Can you help me move on Sunday?'). Otherwise empty."),
  options: z.array(z.string().max(60)).max(6).describe("poll only: the 2-6 options exactly as the owner gave them. Otherwise empty."),
  time: z.string().max(5).describe("rsvp only: the fixed start time as 24h HH:MM. Otherwise empty."),
  min: z.number().int().min(0).max(20).describe("rsvp only: minimum people needed for it to happen ('need 10'), including the owner. 0 if none."),
  max: z.number().int().min(0).max(20).describe("rsvp only: maximum places ('max 6', 'up to 6'), including the owner. 0 if none."),
  items: z.array(z.string().max(80)).max(20).describe("assign only: the items or roles to claim, exactly as given. Otherwise empty."),
  message: z.string().max(1000).describe("announce only: the message to send, exactly as the owner wrote it. Otherwise empty."),
});
export type Intent = z.infer<typeof IntentSchema>;

/** A free question for a person, relayed by their agent. Sent as an A2A DataPart. */
export const QuestionRequestSchema = z.object({
  type: z.literal("agentme.question"),
  question: z.string().min(1).max(500),
});
export type QuestionRequest = z.infer<typeof QuestionRequestSchema>;

/** A business agent's answer: the text, and whether its team should be asked instead. */
export const BusinessAnswerSchema = z.object({
  answer: z.string().max(1500).describe("The answer to the visitor, 1-3 sentences."),
  needs_team: z.boolean().describe("true when the information isn't in the business info or website content."),
  source_url: z.string().default("").describe("The page address the answer came from (website content only), or empty."),
});

/** "Ask around": a contact asks for a recommendation (answered from a saved tip, or by the person). */
export const AskAroundRequestSchema = z.object({
  type: z.literal("agentme.ask_around"),
  question: z.string().min(1).max(500),
});
export type AskAroundRequest = z.infer<typeof AskAroundRequestSchema>;

/** What a coordination request asks another agent for. Sent as an A2A DataPart. */
export const CoordinationRequestSchema = z.object({
  type: z.literal("agentme.coordination.request"),
  event: z.string().max(60),
  window: z.string().max(80),
  categories: z.array(z.string()).max(5),
  note: z.string().max(500).optional(),
});
export type CoordinationRequest = z.infer<typeof CoordinationRequestSchema>;

export const CoordinationReplySchema = z.object({
  availability: z.string().max(200).nullable(),
  food: z.string().max(200).nullable(),
  location: z.string().max(200).nullable(),
  // Newer topics: optional, so replies stored before they existed still read.
  interests: z.string().max(200).nullable().default(null),
  budget: z.string().max(200).nullable().default(null),
  practical: z.string().max(200).nullable().default(null),
  summary: z.string().max(240),
});
export type CoordinationReply = z.infer<typeof CoordinationReplySchema>;

export const ProposalSchema = z.object({
  title: z.string().max(120),
  day: z.string().max(40),
  time: z.string().regex(/^\d{2}:\d{2}$/).describe("24-hour HH:MM"),
  cuisine: z.string().max(60).nullable(),
  participants: z.array(z.string()).describe("Handles (no @) of everyone attending, including the organiser."),
  rationale: z.string().max(400),
});
export type Proposal = z.infer<typeof ProposalSchema>;

export const DISCLAIMER = "Demo: no reservation has been made. Your agent never books or pays.";
