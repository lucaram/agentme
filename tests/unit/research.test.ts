import { describe, expect, it } from "vitest";
import { answerForDraft, answerMessage, buildAnswer, cacheSeconds, cacheText, mockRoute, parseResearchText, unverifiedNumbers } from "@/lib/research/answer";
import { mockResearch } from "@/lib/research/mock";
import { indexWords, isPublicDomain, rankIndexHits, sitemapEntries } from "@/lib/business/site";
import { splitInline, summonsAgent } from "@/lib/agents/commands";
import { readResearch } from "@/lib/llm/anthropic";

const NOW = new Date("2026-11-13T10:00:00Z");
const SOURCE = { url: "https://www.example.com/falkirk", title: "Falkirk weather" };

describe("research: what code checks before anything is called an answer", () => {
  it("an answer without a source is never presented as verified", () => {
    const a = buildAnswer("STATUS: answered\nIt's 12°C in Falkirk.", [], [], NOW);
    expect(a.status).toBe("not_found");
    expect(a.text).not.toContain("12");
    expect(a.sources).toEqual([]);
  });

  it("numbers must appear in what was read; otherwise the answer is only partial, with a caution", () => {
    const ok = buildAnswer("STATUS: answered\nIt's 12°C in Falkirk.", [SOURCE], ["Falkirk: 12°C, light rain"], NOW);
    expect(ok.status).toBe("answered");
    const bad = buildAnswer("STATUS: answered\nIt scored 85 out of 100.", [SOURCE], ["The review gives it 8,5."], NOW);
    expect(bad.status).toBe("partial");
    expect(bad.unverified).toEqual(["85", "100"]);
    expect(answerMessage(bad)).toContain("⚠️ I couldn't confirm 85, 100");
  });

  it("a decimal comma and a decimal point are the same number; single digits aren't checked", () => {
    expect(unverifiedNumbers("Rated 8.5, in 3 parts", ["Voto: 8,5"])).toEqual([]);
    expect(unverifiedNumbers("It costs £3.80", ["Latte £3.90"])).toEqual(["3.80"]);
  });

  it("an unclear request becomes a question with options, not a guess", () => {
    const a = buildAnswer("STATUS: needs_clarification\nWhich Castlevania game do you mean?\nOPTION: Lords of Shadow\nOPTION: Nocturne", [], [], NOW);
    expect(a.status).toBe("needs_clarification");
    expect(a.clarification).toEqual({ question: "Which Castlevania game do you mean?", options: ["Lords of Shadow", "Nocturne"] });
    expect(answerMessage(a)).toContain("- Nocturne");
    expect(answerForDraft(a)).toBe(""); // nothing to put in your message
  });

  it("not found stays not found, and a missing status line is read as an answer", () => {
    expect(parseResearchText("STATUS: not_found\nNo reliable page.").status).toBe("not_found");
    expect(parseResearchText("It's sunny.")).toEqual({ status: "answered", text: "It's sunny." });
    expect(parseResearchText("STATUS: needs_clarification\nWhich one?\nOPTION: only one").status).toBe("answered"); // one option isn't a choice
  });

  it("the answer names where it's from; the draft is short, with one source line", () => {
    const a = buildAnswer("STATUS: answered\nIt's 12°C in Falkirk.", [SOURCE], ["12°C"], NOW);
    expect(answerMessage(a)).toBe("It's 12°C in Falkirk.\n\n🔗 From example.com");
    expect(answerForDraft(a)).toBe("It's 12°C in Falkirk.\n(Source: https://www.example.com/falkirk)");
    expect(a.retrievedAt).toBe(NOW.toISOString());
  });
});

describe("research: routing and reuse", () => {
  it("weather is looked up now, news recently; chat stays chat (test stand-in)", () => {
    expect(mockRoute("What's the weather in Falkirk?")).toMatchObject({ kind: "research", time: "now", place: "Falkirk" });
    expect(mockRoute("Any news about the Mars mission?")).toMatchObject({ kind: "research", time: "recent" });
    expect(mockRoute("poll: pizza or sushi?")).toMatchObject({ kind: "chat", question: "" });
    expect(mockRoute("Help me write a toast for Marco")).toMatchObject({ kind: "chat" });
  });

  it("current conditions are reused for half an hour, news for hours, the rest for a week", () => {
    expect(cacheSeconds("now")).toBe(1800);
    expect(cacheSeconds("recent")).toBe(6 * 3600);
    expect(cacheSeconds("past")).toBe(7 * 86_400);
  });

  it("the same question about the same websites is the same look-up", () => {
    expect(cacheText("What's the weather in Falkirk?")).toBe(cacheText("  what's THE   weather in falkirk!! "));
    expect(cacheText("opening hours", ["b.com", "a.com"])).toBe(cacheText("Opening hours!", ["a.com", "b.com"]));
    expect(cacheText("opening hours", ["a.com"])).not.toBe(cacheText("opening hours"));
  });

  it("the test stand-in never invents: weather with a source, otherwise not found", () => {
    const weather = mockResearch("What's the weather in Falkirk?");
    expect(buildAnswer(weather.text, weather.sources, weather.evidence, NOW)).toMatchObject({ status: "answered", text: "In Falkirk it's 12°C with light rain right now." });
    expect(buildAnswer(mockResearch("Who won?").text, [], [], NOW).status).toBe("not_found");
  });
});

describe("research: reading what the web tools returned", () => {
  it("takes the text after the last search, with its cited sources and what was read", () => {
    const blocks = [
      { type: "text", text: "I'll search for that.", citations: null },
      { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "falkirk weather" } },
      { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: "https://w.example/falkirk", title: "Falkirk", page_age: "2 hours ago", encrypted_content: "x" }] },
      {
        type: "text",
        text: "STATUS: answered\nIt's 12°C.",
        citations: [{ type: "web_search_result_location", url: "https://w.example/falkirk", title: "Falkirk", cited_text: "12°C, light rain", encrypted_index: "y" }],
      },
    ] as unknown as Parameters<typeof readResearch>[0];
    const r = readResearch(blocks);
    expect(r.text).toBe("STATUS: answered\nIt's 12°C.");
    expect(r.sources).toEqual([{ url: "https://w.example/falkirk", title: "Falkirk", quote: "12°C, light rain", pageAge: "2 hours ago" }]);
    expect(r.evidence).toContain("12°C, light rain");
    expect(r.errors).toEqual([]);
  });

  it("a failed search is an error, not an answer with sources", () => {
    const blocks = [
      { type: "server_tool_use", id: "s1", name: "web_search", input: {} },
      { type: "web_search_tool_result", tool_use_id: "s1", content: { type: "web_search_tool_result_error", error_code: "too_many_requests" } },
      { type: "text", text: "STATUS: answered\nProbably 12°C.", citations: null },
    ] as unknown as Parameters<typeof readResearch>[0];
    const r = readResearch(blocks);
    expect(r.errors).toEqual(["search: too_many_requests"]);
    expect(r.sources).toEqual([]);
    expect(buildAnswer(r.text, r.sources, r.evidence, NOW).status).toBe("not_found");
  });
});

describe("a business's address index (pages found, read only when asked)", () => {
  it("reads addresses, dates and news titles from a sitemap, and nested sitemaps", () => {
    const xml = `<urlset><url><loc>https://x.com/recensioni/castlevania-nocturne.html</loc><lastmod>2026-01-05</lastmod><news:news><news:title><![CDATA[Castlevania Nocturne: la recensione]]></news:title></news:news></url><url><loc>https://x.com/a?b=1&amp;c=2</loc></url></urlset>`;
    expect(sitemapEntries(xml)).toEqual([
      { loc: "https://x.com/recensioni/castlevania-nocturne.html", lastmod: "2026-01-05T00:00:00.000Z", title: "Castlevania Nocturne: la recensione" },
      { loc: "https://x.com/a?b=1&c=2", lastmod: null, title: null },
    ]);
    expect(sitemapEntries("<sitemapindex><sitemap><loc>https://x.com/s1.xml</loc></sitemap></sitemapindex>")[0].loc).toBe("https://x.com/s1.xml");
  });

  it("an address is found by the words in it (and its title)", () => {
    expect(indexWords("https://x.com/recensioni/castlevania-nocturne.html")).toBe("recensioni castlevania nocturne");
    expect(indexWords("https://x.com/p/123", "Caffè Aurora")).toBe("123 caffe aurora");
  });

  it("the best matches: most of the question's words, newest first, at most three", () => {
    const rows = [
      { url: "/a", words: "news castlevania nocturne trailer", lastmod: "2025-01-01T00:00:00.000Z" },
      { url: "/b", words: "recensioni castlevania nocturne", lastmod: "2026-01-01T00:00:00.000Z" },
      { url: "/c", words: "recensioni zelda", lastmod: null },
      { url: "/d", words: "castlevania symphony", lastmod: null },
    ];
    expect(rankIndexHits(["castlevania", "nocturne", "recension"], rows).map((r) => r.url)).toEqual(["/b", "/a"]);
    expect(rankIndexHits(["parking", "nearby"], rows)).toEqual([]);
    expect(rankIndexHits([], rows)).toEqual([]);
  });

  it("only a public domain can be searched on the web", () => {
    expect(isPublicDomain("everyeye.it")).toBe(true);
    expect(isPublicDomain("localhost")).toBe(false);
    expect(isPublicDomain("127.0.0.1")).toBe(false);
  });
});

describe("@agent inside a message", () => {
  it("keeps the person's own words exactly, and gives the rest to their agent", () => {
    expect(splitInline("I'm fine thanks. @agent: what's the weather in Falkirk?")).toEqual({ own: "I'm fine thanks.", instruction: "what's the weather in Falkirk?" });
    expect(splitInline("See you at 8! @agent translate to Italian")).toEqual({ own: "See you at 8!", instruction: "translate to Italian" });
    expect(splitInline("Sounds good, @agent: add the latest score")).toEqual({ own: "Sounds good,", instruction: "add the latest score" });
  });

  it("only when it's clearly addressed to the agent", () => {
    expect(splitInline("ask @agent later")).toBeNull();
    expect(splitInline("I like @agentme. It's great")).toBeNull();
    expect(splitInline("@agent summarise")).toBeNull(); // a command from the start, not inline
    expect(splitInline("I'm fine thanks. @agent:")).toBeNull(); // nothing asked
    expect(summonsAgent("I'm fine thanks. @agent: weather in Falkirk?")).toBe(true);
    expect(summonsAgent("@agent summarise")).toBe(true);
    expect(summonsAgent("ask @agent later")).toBe(false);
  });
});
