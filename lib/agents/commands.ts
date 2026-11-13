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

/** The instruction used when "@agent reply" says nothing more. */
export const DEFAULT_DRAFT = "a friendly reply to the latest message";

const SUMMARY_VERB = /^(summari[sz]e|recap|catch me up|tl;?dr)\b[\s,:-]*/i;
/** Words that say how to summarise, not what: "very concisely", "briefly", "in three lines", "please". */
const HOW = /\b(very|really|quite|super|concisely|concise|briefly|brief|quickly|quick|short|shortly|please|for me|in (a few|one|two|three|\d+) (words?|lines?|sentences?|bullets?|points?))\b/gi;
/** What "summarise" is about when it IS about this chat. */
const THE_CHAT =
  /^(on\s+)?((all( of)?\s+)?(this|that|it|everything)|(this|the|our|that)?\s*(whole|entire|last|latest|recent)?\s*(chat|conversation|convo|discussion|thread|group|exchange|messages?)(\s+(so far|above|here|today))?|(the\s+)?(above|last \d+ messages?)|so far|today|what\b.*)$/i;

/**
 * Is "summarise …" about this chat? Yes with nothing after it, or when what
 * follows is the chat ("this", "the discussion", "what we decided"). "summarise
 * the weather in Miami" is not: it's a request about something else.
 */
function summarisesChat(rest: string): boolean {
  const verb = rest.match(SUMMARY_VERB);
  if (!verb) return false;
  const about = rest.slice(verb[0].length).replace(HOW, " ").replace(/[.!?,;:]+/g, " ").replace(/\s+/g, " ").trim();
  if (!about || THE_CHAT.test(about)) return true;
  // A few words that name the chat itself: "today's chat", "the group chat since Monday".
  return /\b(chat|conversation|convo|discussion|thread|messages?)\b/i.test(about) && about.split(" ").length <= 5;
}

export function parseAgentCommand(text: string): AgentCommand {
  const rest = text.replace(PREFIX, "").trim();
  if (!rest || summarisesChat(rest) || /^(what did (we|they) (decide|agree|say)|what('s| is| was) (decided|agreed))\b/i.test(rest)) {
    return { mode: "summarise" };
  }
  const translate = rest.match(/^translate\b(?:\s+(?:to|into)\s+([a-z]+))?[\s:,-]*(.*)$/i);
  if (translate) {
    const language = translate[1] ? translate[1][0].toUpperCase() + translate[1].slice(1).toLowerCase() : "English";
    return { mode: "translate", language, text: translate[2]?.trim() ?? "" };
  }
  const draft = rest.match(/^(?:draft|write|reply|answer|respond)\b[\s:,-]*(.*)$/i);
  if (draft) return { mode: "draft", instruction: draft[1].trim() || DEFAULT_DRAFT };
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
