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

/**
 * "@agent" inside a message: "I'm fine thanks. @agent: what's the weather in
 * Falkirk?". What comes before is the person's own words (kept exactly); what
 * comes after is for their agent. Only when it's clearly addressed to the agent
 * ("@agent:" / "@agent,", or after the end of a sentence), so "ask @agent
 * later" stays an ordinary message.
 */
export function splitInline(text: string): { own: string; instruction: string } | null {
  if (isAgentCommand(text)) return null;
  const m = text.match(/^([\s\S]*?\S)\s+@agent\b([\s,:]*)([\s\S]*)$/i);
  if (!m) return null;
  const own = m[1].trim();
  const instruction = m[3].trim();
  const addressed = /[:,]/.test(m[2]) || /[.!?…]$/.test(own);
  return addressed && instruction ? { own, instruction } : null;
}

/** Does this message summon the sender's agent (at the start, or inline)? */
export function summonsAgent(text: string): boolean {
  return isAgentCommand(text) || splitInline(text) !== null;
}
