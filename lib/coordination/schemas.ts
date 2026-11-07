import { z } from "zod";

export const IntentSchema = z.object({
  is_coordination: z.boolean().describe("True if the owner wants their agent to organise something with other people."),
  event: z.string().max(60).describe('Short event name, e.g. "dinner", "coffee", "call".'),
  window: z.string().max(80).describe('When, in the owner\'s words, e.g. "Saturday evening".'),
  participants: z.array(z.string()).describe("Handles mentioned with @, without the @."),
  categories: z
    .array(z.enum(["availability", "food", "location"]))
    .describe("Which kinds of information the agent needs from the other agents."),
});
export type Intent = z.infer<typeof IntentSchema>;

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
