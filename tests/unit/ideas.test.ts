import { describe, expect, it } from "vitest";
import { chatIdeas, personalIdeas } from "@/lib/agents/ideas";
import { parseAskAround } from "@/lib/people/askAround";
import { parseIntroduceCommand } from "@/lib/people/introductions";
import { parseAgentCommand } from "@/lib/agents/commands";

describe("💡 Ideas", () => {
  it("fills personal ideas with real names, and a business you know", () => {
    const ideas = personalIdeas({ friends: ["marco", "paul"], business: "trattoria", used: new Set() });
    expect(ideas.map((i) => i.label)).toEqual(["🍝 Dinner", "🍕 Food", "🔎 Ask around", "🤝 Introduce", "📊 Polls", "🧺 Who brings what", "🧠 Remember"]);
    expect(ideas.find((i) => i.label === "🍕 Food")?.text).toBe("Organise pizza at @trattoria on Friday at 8pm with @marco");
  });

  it("leaves out what can't work, and moves ideas already tried to the end", () => {
    const one = personalIdeas({ friends: ["marco"], business: null, used: new Set(["poll", "ask_around"]) });
    expect(one.map((i) => i.label)).toEqual(["🍝 Dinner", "🧺 Who brings what", "🧠 Remember", "🔎 Ask around", "📊 Polls"]);
  });

  it("each idea is understood the way it's meant", () => {
    const ideas = personalIdeas({ friends: ["marco", "paul"], business: "trattoria", used: new Set() });
    expect(parseAskAround(ideas.find((i) => i.label === "🔎 Ask around")!.text!)).not.toBeNull();
    expect(parseIntroduceCommand(ideas.find((i) => i.label === "🤝 Introduce")!.text!)).toMatchObject({ a: "marco", b: "paul" });
    const group = chatIdeas({ kind: "group", business: "trattoria", moderator: false });
    expect(parseAgentCommand(group.find((i) => i.label === "📝 Catch up")!.text!)).toEqual({ mode: "summarise" });
    expect(parseAgentCommand(group.find((i) => i.label === "🌐 Translate")!.text!)).toEqual({ mode: "translate", language: "Italian", text: "" });
    expect(parseAgentCommand(group.find((i) => i.label === "✍️ Draft a reply")!.text!)).toMatchObject({ mode: "draft" });
    expect(group.at(-1)?.text).toBe("@trattoria do you have a table for 6 on Friday?");
    const community = chatIdeas({ kind: "channel", business: null, moderator: false });
    expect(community.map((i) => i.label)).toEqual(["📝 Catch up", "🌐 Translate"]);
    expect(parseAgentCommand(community[0].text!)).toEqual({ mode: "summarise" });
  });
});
