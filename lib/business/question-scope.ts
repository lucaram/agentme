import { z } from "zod";

export const BusinessScopeSchema = z.object({
  scope: z.enum(["general", "customer_specific", "personal_plan", "unrelated", "unclear"]).describe("general: this business's products, services, policies or facilities, including genuine pre-booking questions. customer_specific: a customer's private booking, order or account. personal_plan: private group agreements, attendance or arrangements; a venue name does not make those business questions. unrelated: not this business's responsibility. unclear: insufficient context."),
});
export const PublicationSchema = z.object({
  reusable: z.boolean().describe("True only for a general public business fact with no personal/customer details, names, attendance, specific booking/order/account information or private arrangements. Both question AND answer must be safe to publish as a public FAQ. False if uncertain."),
});
export type BusinessScope = z.infer<typeof BusinessScopeSchema>["scope"];

export function isPersonalPlanQuestion(question: string): boolean {
  return /\b(we (agree|agreed|decide|decided)|our (dinner|plan|meeting)|what time did we|who('s| is| are)? (coming|attending))\b/i.test(question);
}
export function isCustomerSpecificQuestion(question: string): boolean {
  return /\b(my|our) (booking|reservation|order|account)|booking (reference|number)|cancel my|table for me\b/i.test(question);
}
export function mockBusinessScope(question: string): BusinessScope {
  if (isPersonalPlanQuestion(question)) return "personal_plan";
  if (isCustomerSpecificQuestion(question)) return "customer_specific";
  if (/\b(weather|castlevania|football results|write.*poem)\b/i.test(question)) return "unrelated";
  return "general";
}

export function mockPublication(question: string, answer: string): boolean {
  return mockBusinessScope(question) === "general" && !/\b(booking|reservation|order|account) (number|reference)|\b(luca|marco|paul)\b|@[a-z]|\b\d{1,2} (january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(answer);
}

export const HandoffOfferSchema = z.object({
  type: z.literal("agentme.business.handoff_offer"),
  question: z.string().trim().min(1).max(1000),
  faq_eligible: z.boolean(),
});

export function handoffMetadata(data: unknown, taskId?: string | null): Record<string, string | boolean> {
  return taskId && HandoffOfferSchema.safeParse(data).success ? { handoff_offer: true, a2a_task: taskId } : {};
}
