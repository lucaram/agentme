/**
 * "@agent ..." in any chat. Parsing is deterministic (code), so what the agent
 * does in a shared chat never depends on a model's interpretation.
 */

export type AgentCommand =
  | { mode: "summarise" }
  | { mode: "translate"; language: string; text: string }
  | { mode: "draft"; instruction: string }
  /** Anything else: organise something with this chat's members, or a private answer. */
  | { mode: "plan"; request: string };

const PREFIX = /^\s*@agent\b[\s,:]*/i;

export function isAgentCommand(text: string): boolean {
  return PREFIX.test(text);
}

export function parseAgentCommand(text: string): AgentCommand {
  const rest = text.replace(PREFIX, "").trim();
  if (!rest || /^(summari[sz]e|recap|catch me up|tl;?dr|what did (we|they) (decide|agree|say)|what('s| is| was) (decided|agreed))\b/i.test(rest)) {
    return { mode: "summarise" };
  }
  const translate = rest.match(/^translate\b(?:\s+(?:to|into)\s+([a-z]+))?[\s:,-]*(.*)$/i);
  if (translate) {
    const language = translate[1] ? translate[1][0].toUpperCase() + translate[1].slice(1).toLowerCase() : "English";
    return { mode: "translate", language, text: translate[2]?.trim() ?? "" };
  }
  const draft = rest.match(/^(?:draft|write|reply|answer|respond)\b[\s:,-]*(.*)$/i);
  if (draft) return { mode: "draft", instruction: draft[1].trim() || "a friendly reply to the latest message" };
  return { mode: "plan", request: rest };
}
