/**
 * Ask around, from the asked person's side: only contacts can ask, people can
 * opt out, the agent shares only a saved tip on the same topic (never private
 * facts), and otherwise the person decides. No model is involved.
 */
import { describe, expect, it } from "vitest";
import { respondAsAgent, type RecipientAgent } from "@/lib/agents/respond";
import type { Fact } from "@/lib/policy/disclosure";

const paul: RecipientAgent = { id: "paul-id", handle: "paul", type: "personal", contact_policy: "contacts_only", display_name: "Paul", business_info: {}, recommendations_ok: true };
const facts: Fact[] = [{ category: "notes", value: "PRIVATE: my plumber overcharged me", disclosure: "private" }];
const tips = [{ topic: "plumber", tip: "Joe's Plumbing, 020 7946 0000" }];
const ask = (question: string) => ({ type: "agentme.ask_around", question });
const from = (relationship: "accepted" | "none" | "blocked") => ({ callerHandle: "luca", relationship, text: "", data: ask("Does anyone know a good plumber?") });

describe("ask around (security)", () => {
  it("only contacts can ask, and only people who allow it", async () => {
    expect(await respondAsAgent(paul, from("none"), facts, tips)).toMatchObject({ status: "refused", disclosed: [] });
    expect(await respondAsAgent(paul, from("blocked"), facts, tips)).toMatchObject({ status: "refused", disclosed: [] });
    expect(await respondAsAgent({ ...paul, recommendations_ok: false }, from("accepted"), facts, tips)).toMatchObject({ status: "refused", reason: "not_taking_requests" });
  });

  it("a saved tip on the topic is shared by the agent, nothing else", async () => {
    const res = await respondAsAgent(paul, from("accepted"), facts, tips);
    expect(res).toMatchObject({ status: "completed", skill: "coordination.ask_around", disclosed: ["saved_tip"], data: { answer: "Joe's Plumbing, 020 7946 0000", from: "saved_tip" } });
    expect(JSON.stringify(res)).not.toContain("PRIVATE");
  });

  it("without a matching tip, the person decides (nothing is shared)", async () => {
    const res = await respondAsAgent(paul, { ...from("accepted"), data: ask("Who can lend me a drill?") }, facts, tips);
    expect(res).toMatchObject({ status: "needs_human", disclosed: [], inbox: { kind: "question", question: "Who can lend me a drill?", ask_around: true } });
  });
});
