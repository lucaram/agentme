import type { ResearchSource } from "./answer";

/**
 * Deterministic stand-in for web research (tests, no API key): a fixed
 * weather answer, a clarification for an ambiguous game title, and "not
 * found" for everything else. Never touches the network.
 */
export function mockResearch(question: string): { text: string; sources: ResearchSource[]; evidence: string[] } {
  if (/\b(weather|forecast|temperature|meteo)\b/i.test(question)) {
    const place = question.match(/\b(?:in|at|a|ad)\s+([A-Z][\p{L}'-]+)/u)?.[1] ?? "your area";
    return {
      text: `STATUS: answered\nIn ${place} it's 12°C with light rain right now.`,
      sources: [{ url: `https://weather.example/${place.toLowerCase()}`, title: `${place} weather (demo)`, quote: "12°C, light rain" }],
      evidence: ["12°C, light rain"],
    };
  }
  if (/\bcastlevania\b/i.test(question) && !/\b(nocturne|shadow|symphony)\b/i.test(question)) {
    return {
      text: "STATUS: needs_clarification\nWhich Castlevania game do you mean?\nOPTION: Castlevania: Lords of Shadow\nOPTION: Castlevania: Nocturne",
      sources: [],
      evidence: [],
    };
  }
  return { text: "STATUS: not_found\nI couldn't find a reliable source for that.", sources: [], evidence: [] };
}
