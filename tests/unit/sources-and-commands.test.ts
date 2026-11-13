import { describe, expect, it } from "vitest";
import { answerForDraft, answerMessage, buildAnswer, namedElsewhere, usedSources } from "@/lib/research/answer";
import { parseAgentCommand } from "@/lib/agents/commands";
import { readResearch } from "@/lib/llm/anthropic";

const NOW = new Date("2026-11-13T19:00:00Z");
const WEATHER_COM = { url: "https://weather.com/weather/today/l/Polmont", title: "Polmont Weather Forecast" };
const ACCU = { url: "https://www.accuweather.com/en/gb/polmont/weather", title: "Polmont, Falkirk Weather | AccuWeather" };

describe("the source shown is the page the facts came from", () => {
  it("only the pages the answer cites count, in the order found", () => {
    expect(usedSources([WEATHER_COM, { ...ACCU, cited: true }])).toEqual([ACCU]);
    expect(usedSources([{ ...WEATHER_COM, cited: true }, { ...ACCU, cited: true }]).map((s) => s.url)).toEqual([WEATHER_COM.url, ACCU.url]);
  });

  it("when nothing is marked as cited, every page counts (pages the app read itself)", () => {
    expect(usedSources([WEATHER_COM, ACCU])).toEqual([WEATHER_COM, ACCU]);
    expect(usedSources([])).toEqual([]);
  });

  it("a page opened along the way is not the source of an answer that cites another", () => {
    // The model opened weather.com, then answered from an AccuWeather search result.
    const blocks = [
      { type: "server_tool_use", id: "f1", name: "web_fetch", input: {} },
      { type: "web_fetch_tool_result", tool_use_id: "f1", content: { type: "web_fetch_result", url: WEATHER_COM.url, retrieved_at: null, content: { type: "document", title: WEATHER_COM.title, source: { type: "text", media_type: "text/plain", data: "Polmont. Mostly cloudy." } } } },
      { type: "server_tool_use", id: "s1", name: "web_search", input: {} },
      { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: ACCU.url, title: ACCU.title }] },
      { type: "text", text: "STATUS: answered\nIt's 3°C and mostly cloudy in Polmont.", citations: [{ type: "web_search_result_location", url: ACCU.url, title: ACCU.title, cited_text: "3°C Mostly cloudy" }] },
    ] as unknown as Parameters<typeof readResearch>[0];
    const read = readResearch(blocks);
    expect(read.sources.map((s) => [s.url, Boolean(s.cited)])).toEqual([[WEATHER_COM.url, false], [ACCU.url, true]]);
    const answer = buildAnswer(read.text, read.sources, read.evidence, NOW);
    expect(answer.status).toBe("answered");
    expect(answer.sources.map((s) => s.url)).toEqual([ACCU.url]);
    expect(answerForDraft(answer)).toBe(`It's 3°C and mostly cloudy in Polmont.\n(Source: ${ACCU.url})`);
    expect(answerMessage(answer)).toContain("🔗 From accuweather.com");
    expect(answerMessage(answer)).not.toContain("weather.com,");
  });

  it("a citation into a page that was opened marks that page", () => {
    const blocks = [
      { type: "server_tool_use", id: "f1", name: "web_fetch", input: {} },
      { type: "web_fetch_tool_result", tool_use_id: "f1", content: { type: "web_fetch_result", url: WEATHER_COM.url, retrieved_at: null, content: { type: "document", title: WEATHER_COM.title, source: { type: "text", media_type: "text/plain", data: "Polmont 3°C" } } } },
      { type: "text", text: "STATUS: answered\nIt's 3°C.", citations: [{ type: "char_location", document_title: WEATHER_COM.title, cited_text: "Polmont 3°C", document_index: 0, start_char_index: 0, end_char_index: 11 }] },
    ] as unknown as Parameters<typeof readResearch>[0];
    expect(readResearch(blocks).sources).toEqual([{ ...WEATHER_COM, cited: true }]);
  });
});

describe("a website the text names must be among the pages read", () => {
  it("'AccuWeather's reading' with only weather.com as a source is flagged", () => {
    const text = "AccuWeather's reading for Polmont at 7:02 PM was 3°C and mostly cloudy.";
    expect(namedElsewhere(text, [WEATHER_COM], ["Polmont 3°C mostly cloudy 7:02 PM"])).toEqual(["AccuWeather"]);
    const answer = buildAnswer(`STATUS: answered\n${text}`, [WEATHER_COM], ["Polmont 3°C mostly cloudy 7:02 PM"], NOW);
    expect(answer).toMatchObject({ status: "partial", unsourced: ["AccuWeather"] });
    expect(answerMessage(answer)).toContain("⚠️ It mentions AccuWeather, which isn't among the pages I read");
  });

  it("fine when that website is a source, or is mentioned in what was read", () => {
    expect(namedElsewhere("AccuWeather's reading was 3°C.", [ACCU])).toEqual([]);
    expect(namedElsewhere("According to Nintendo, it sold 5 million copies.", [WEATHER_COM], ["Nintendo said the remake sold 5 million copies"])).toEqual([]);
    expect(namedElsewhere("According to the Met Office it will rain.", [{ url: "https://www.metoffice.gov.uk/x", title: "Forecast" }])).toEqual([]);
  });

  it("other ways of naming a source, and addresses written in the text", () => {
    expect(namedElsewhere("It will rain, according to BBC Weather.", [WEATHER_COM])).toEqual(["BBC Weather"]);
    expect(namedElsewhere("Rain tomorrow (source: Sky News).", [WEATHER_COM])).toEqual(["Sky News"]);
    expect(namedElsewhere("See accuweather.com for more.", [WEATHER_COM])).toEqual(["accuweather.com"]);
    expect(namedElsewhere("See weather.com for more.", [WEATHER_COM])).toEqual([]);
  });

  it("ordinary sentences aren't flagged", () => {
    expect(namedElsewhere("It's 3°C in Polmont. Tomorrow looks sunny, then showers.", [WEATHER_COM])).toEqual([]);
    expect(namedElsewhere("Marco's forecast was wrong; per day it costs 5 pounds.", [WEATHER_COM], ["Marco"])).toEqual([]);
  });
});

describe("@agent command words don't swallow a request about something else", () => {
  it("'summarise' with nothing after it, or about this chat, summarises the chat", () => {
    for (const t of [
      "@agent summarise",
      "@agent summarise this",
      "@agent summarise very concisely",
      "@agent summarize the discussion so far, briefly",
      "@agent recap the last 20 messages",
      "@agent catch me up",
      "@agent tl;dr",
      "@agent summarise what we decided",
      "@agent summarise everything in three lines please",
      "@agent summarise today's chat",
      "@agent recap the group chat since Monday",
    ]) {
      expect(parseAgentCommand(t), t).toEqual({ mode: "summarise" });
    }
  });

  it("'summarise' about something else is a request, passed on whole", () => {
    expect(parseAgentCommand("@agent summarise very concisely the weather in Miami")).toEqual({ mode: "plan", request: "summarise very concisely the weather in Miami" });
    expect(parseAgentCommand("@agent recap the news about the Mars mission")).toEqual({ mode: "plan", request: "recap the news about the Mars mission" });
    expect(parseAgentCommand("@agent summarise the review of Zelda on Everyeye")).toMatchObject({ mode: "plan" });
  });
});
