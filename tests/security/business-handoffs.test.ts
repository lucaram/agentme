import { afterEach, expect, it, vi } from "vitest";
import { respondAsAgent, type RecipientAgent } from "@/lib/agents/respond";
import { setLLMProviderForTesting } from "@/lib/llm";
import { MockProvider } from "@/lib/llm/mock";
import { mayPublishBusinessAnswer } from "@/lib/business/handoff";

const shop: RecipientAgent = { id: "shop", handle: "trattoria", type: "business", display_name: "Trattoria Sole", contact_policy: "anyone", business_info: {} };
afterEach(() => setLLMProviderForTesting(undefined));
const ask = (text: string, callerHandle: string | null = "luca") => respondAsAgent(shop, { callerHandle, text, data: null, relationship: "none" }, [], [], { sources: [] });

it.each(["What time did we agree for dinner at @Trattoria on 21 November, and who is coming?", "Who is coming to our dinner?"])("keeps personal questions out of the business's staff inbox: %s", async (text) => {
  setLLMProviderForTesting(new MockProvider());
  const result = await ask(text);
  expect(result).toMatchObject({ status: "completed", disclosed: [] });
  expect(result).not.toHaveProperty("inbox");
  expect(result).not.toHaveProperty("data");
});
it("offers a real pre-booking question without invoking staff, and gives anonymous callers no offer", async () => {
  setLLMProviderForTesting(new MockProvider());
  const result = await ask("Can you securely store four bicycles indoors?");
  expect(result).toMatchObject({ status: "completed", data: { type: "agentme.business.handoff_offer", faq_eligible: true } });
  expect(result).not.toHaveProperty("inbox");
  expect(await ask("Can you securely store four bicycles indoors?", null)).not.toHaveProperty("data");
});
it("refuses public publication of personal and customer-specific answers and fails closed if the classifier fails", async () => {
  setLLMProviderForTesting(new MockProvider());
  expect(await mayPublishBusinessAnswer("Can you store bicycles?", "We store up to four bicycles inside during meals.")).toBe(true);
  expect(await mayPublishBusinessAnswer("Who is coming to our dinner?", "Luca and Marco")).toBe(false);
  expect(await mayPublishBusinessAnswer("Is my order ready?", "Order 12345 is ready.")).toBe(false);
  expect(await mayPublishBusinessAnswer("Can you store bicycles?", "Luca will arrive on 21 November.")).toBe(false);
  const broken = new MockProvider();
  vi.spyOn(broken, "generateObject").mockRejectedValue(new Error("offline"));
  setLLMProviderForTesting(broken);
  expect(await mayPublishBusinessAnswer("Can you store bicycles?", "Yes")).toBe(false);
});
