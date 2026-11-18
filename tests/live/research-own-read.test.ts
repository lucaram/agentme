/**
 * News sites the search's reader can't open: the app reads the site the request names itself, and
 * for the latest news uses the site's own feed. A small local "news site" stands in for the real one.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbUp } from "./env";

describe.skipIf(!dbUp)("research: reading a named news site ourselves (live)", () => {
  let server: Server;
  let base = "";
  const was = process.env.ALLOW_LOCAL_FETCH;
  beforeAll(async () => {
    process.env.ALLOW_LOCAL_FETCH = "1";
    server = createServer((req, res) => {
      if (req.url === "/news") {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(`<html><head><title>Local News</title><link rel="alternate" type="application/rss+xml" href="/news/rss.xml"></head><body><h1>Local News</h1><p>${"Menu Sport Weather Business. ".repeat(20)}</p></body></html>`);
      }
      if (req.url === "/news/rss.xml") {
        res.writeHead(200, { "content-type": "application/rss+xml" });
        return res.end(`<?xml version="1.0"?><rss><channel><item><title>Headline one: harbour bridge reopens after storm</title><description>The harbour bridge reopened this morning.</description></item><item><title>Headline two: library extends opening hours</title></item></channel></rss>`);
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    if (was === undefined) delete process.env.ALLOW_LOCAL_FETCH;
    else process.env.ALLOW_LOCAL_FETCH = was;
    await new Promise((resolve) => server.close(resolve));
  });

  it("the web search answers from another site: the named site is read by the app instead, latest stories from its feed", async () => {
    const { llm, setLLMProviderForTesting } = await import("@/lib/llm");
    const { researchWeb } = await import("@/lib/research");
    const real = llm();
    // The search's reader couldn't open the named site and answered from a copy elsewhere.
    setLLMProviderForTesting({
      ...real, name: real.name, generateText: real.generateText.bind(real), generateObject: real.generateObject.bind(real), findPages: real.findPages.bind(real),
      research: async () => ({ text: "STATUS: answered\nA republished story about the harbour.", sources: [{ url: "https://copies.example/harbour", title: "Copy", cited: true }], evidence: ["A republished story about the harbour."], errors: [], pagesRead: 1 }),
    } as typeof real);
    try {
      const answer = await researchWeb({ question: `What's the harbour news ${crypto.randomUUID().slice(0, 6)}?`, time: "now", seedUrls: [`${base}/news`] });
      expect(answer.status).toBe("answered");
      expect(answer.text).toContain("harbour bridge reopens");
      expect(answer.sources.map((s) => s.url)).toEqual([`${base}/news`]);
    } finally {
      setLLMProviderForTesting(undefined);
    }
  });

  it("when the search itself fails, the named site is still read", async () => {
    const { llm, setLLMProviderForTesting } = await import("@/lib/llm");
    const { researchWeb } = await import("@/lib/research");
    const real = llm();
    setLLMProviderForTesting({
      ...real, name: real.name, generateText: real.generateText.bind(real), generateObject: real.generateObject.bind(real), findPages: real.findPages.bind(real),
      research: async () => { throw new Error("search down"); },
    } as typeof real);
    try {
      const answer = await researchWeb({ question: `Any library headlines ${crypto.randomUUID().slice(0, 6)}?`, time: "recent", seedUrls: [`${base}/news`] });
      expect(answer.status).toBe("answered");
      expect(answer.text).toContain("library extends opening hours");
    } finally {
      setLLMProviderForTesting(undefined);
    }
  });
});
