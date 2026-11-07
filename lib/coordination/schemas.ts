import { z } from "zod";

export const INTENT_KINDS = ["coordinate", "poll", "question", "chat"] as const;
export type IntentKind = (typeof INTENT_KINDS)[number];

export const IntentSchema = z.object({
  kind: z
    .enum(INTENT_KINDS)
    .describe(
      "coordinate = organise a meeting/event with the mentioned people; poll = ask them to choose between options; question = ask them something and collect their answers; chat = anything else.",
    ),
  event: z.string().max(60).describe('Short event name, e.g. "dinner", "coffee", "call". Empty if not an event.'),
  window: z.string().max(80).describe('When, in the owner\'s words, e.g. "Saturday evening". Empty if not stated.'),
  participants: z.array(z.string()).describe("Handles mentioned with @, without the @."),
  categories: z
    .array(z.enum(["availability", "food", "location"]))
    .describe("coordinate only: which kinds of information the agent needs from the other agents."),
  question: z
    .string()
    .max(500)
    .describe("poll: the question to vote on. question: what to ask, addressed to the recipient (e.g. 'Can you help me move on Sunday?'). Otherwise empty."),
  options: z.array(z.string().max(60)).max(6).describe("poll only: the 2-6 options exactly as the owner gave them. Otherwise empty."),
});
export type Intent = z.infer<typeof IntentSchema>;

/** A free question for a person, relayed by their agent. Sent as an A2A DataPart. */
export const QuestionRequestSchema = z.object({
  type: z.literal("agentme.question"),
  question: z.string().min(1).max(500),
});
export type QuestionRequest = z.infer<typeof QuestionRequestSchema>;

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
