import { describe, expect, it } from "vitest";
import { isAgentCommand, parseAgentCommand } from "@/lib/agents/commands";

describe("@agent commands in chats", () => {
  it("only messages that start with @agent summon the agent", () => {
    expect(isAgentCommand("@agent summarise")).toBe(true);
    expect(isAgentCommand("  @Agent, catch me up")).toBe(true);
    expect(isAgentCommand("ask @agent later")).toBe(false);
    expect(isAgentCommand("@agentme is cool")).toBe(false);
  });

  it("recognises summaries", () => {
    for (const t of ["@agent summarise", "@agent summarize this", "@agent catch me up", "@agent what did we decide?", "@agent", "@agent tl;dr"]) {
      expect(parseAgentCommand(t)).toEqual({ mode: "summarise" });
    }
  });

  it("recognises translations, defaulting to English", () => {
    expect(parseAgentCommand("@agent translate")).toEqual({ mode: "translate", language: "English", text: "" });
    expect(parseAgentCommand("@agent translate to italian: see you at 8")).toEqual({ mode: "translate", language: "Italian", text: "see you at 8" });
  });

  it("recognises drafts", () => {
    expect(parseAgentCommand("@agent draft say I'm in but late")).toEqual({ mode: "draft", instruction: "say I'm in but late" });
    expect(parseAgentCommand("@agent reply")).toEqual({ mode: "draft", instruction: "a friendly reply to the latest message" });
  });

  it("anything else is a plan request (or a private answer)", () => {
    expect(parseAgentCommand("@agent poll: pizza or sushi?")).toEqual({ mode: "plan", request: "poll: pizza or sushi?" });
    expect(parseAgentCommand("@agent organise dinner on Saturday")).toEqual({ mode: "plan", request: "organise dinner on Saturday" });
  });
});
