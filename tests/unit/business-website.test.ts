import { describe, expect, it } from "vitest";
import {
  avatarFor,
  candidateUrl,
  changedLines,
  handleFromDomain,
  hasVerifyToken,
  homePreview,
  linksOnPage,
  normaliseSite,
  rankUrls,
  robotsAllows,
  robotsRules,
  scopeOf,
  shortUrl,
  sitemapLocs,
  verifiesByEmail,
  verifyTag,
} from "@/lib/business/site";
import { citation, clampLearned, itemKey, learnedCount, learnedText, mockChanges, mockLearn, tryQuestions, type Learned } from "@/lib/business/learn";
import { businessKnowledge, pickRelevant, terms, type KnowledgeSource } from "@/lib/business/knowledge";
import { gapTitle, groupQuestions } from "@/lib/business/gaps";

describe("paste your website: the address", () => {
  it("accepts a bare domain, strips the noise, and ignores www for the domain", () => {
    const a = normaliseSite("trattoria.co.uk");
    expect(a.ok && a.url.toString()).toBe("https://trattoria.co.uk/");
    const b = normaliseSite("  https://www.Trattoria.co.uk/menu?ref=ig#top ");
    expect(b.ok && b.url.toString()).toBe("https://www.trattoria.co.uk/menu");
    expect(b.ok && b.domain).toBe("trattoria.co.uk");
  });

  it("refuses things that aren't public websites", () => {
    expect(normaliseSite("").ok).toBe(false);
    expect(normaliseSite("not a site").ok).toBe(false);
    expect(normaliseSite("localhost:3000/demo").ok).toBe(false);
    expect(normaliseSite("http://localhost:3000/demo/site/index.html", { allowLocal: true }).ok).toBe(true);
  });
});

describe("paste your website: which pages to read", () => {
  const base = new URL("https://shop.example/");

  it("keeps pages of the same website (www or not), without #hash or ?query", () => {
    expect(candidateUrl("/menu", base)).toBe("https://shop.example/menu");
    expect(candidateUrl("menu.html#top", base)).toBe("https://shop.example/menu.html");
    expect(candidateUrl("https://www.shop.example/about?ref=1", base)).toBe("https://www.shop.example/about");
    expect(candidateUrl("/price-list.pdf", base)).toBe("https://shop.example/price-list.pdf");
  });

  it("skips other websites, carts, logins, legal pages, files and non-links", () => {
    for (const href of ["https://other.example/x", "/cart", "/basket/", "/my-account/orders", "/wp-login.php", "/privacy-policy", "/terms-and-conditions", "/images/logo.png", "/style.css", "mailto:a@b.co", "tel:+44123", "#top", "javascript:void(0)"]) {
      expect(candidateUrl(href, base), href).toBeNull();
    }
  });

  it("stays inside the folder the address points to", () => {
    const demo = new URL("https://x.example/demo/site/index.html");
    expect(scopeOf(demo)).toBe("/demo/site/");
    expect(candidateUrl("menu.html", demo)).toBe("https://x.example/demo/site/menu.html");
    expect(candidateUrl("/other/page", demo)).toBeNull();
  });

  it("finds links in a page, whatever the quotes, once each", () => {
    const html = `<a href="/menu">Menu</a> <a class="x" href='/visit'>Visit</a> <a href=/faq>FAQ</a> <a href="/menu#top">Again</a> <a href="/a?b=1&amp;c=2">Q</a>`;
    expect(linksOnPage(html, base)).toEqual(["https://shop.example/menu", "https://shop.example/visit", "https://shop.example/faq", "https://shop.example/a"]);
  });

  it("reads page addresses from a sitemap", () => {
    const xml = `<urlset><url><loc>https://a.example/</loc></url><url><loc> https://a.example/menu?a=1&amp;b=2 </loc></url></urlset>`;
    expect(sitemapLocs(xml)).toEqual(["https://a.example/", "https://a.example/menu?a=1&b=2"]);
  });

  it("reads the homepage first, then what customers ask about, then the rest", () => {
    const home = "https://a.example/";
    const ranked = rankUrls(["https://a.example/blog/post-1", "https://a.example/contact", "https://a.example/menu", "https://a.example/about/team/x"], home);
    expect(ranked).toEqual([home, "https://a.example/contact", "https://a.example/menu", "https://a.example/about/team/x", "https://a.example/blog/post-1"]);
  });
});

describe("paste your website: robots.txt is respected", () => {
  it("follows the rules for everyone, the longest rule winning", () => {
    const rules = robotsRules("User-agent: *\nDisallow: /private\nAllow: /private/menu\nSitemap: https://a.example/sitemap.xml\n");
    expect(robotsAllows(rules, "/menu")).toBe(true);
    expect(robotsAllows(rules, "/private/x")).toBe(false);
    expect(robotsAllows(rules, "/private/menu")).toBe(true);
    expect(rules.sitemaps).toEqual(["https://a.example/sitemap.xml"]);
  });

  it("a group just for us wins over *, and wildcards work", () => {
    expect(robotsAllows(robotsRules("User-agent: AGENTME\nDisallow: /\n\nUser-agent: *\nAllow: /\n"), "/")).toBe(false);
    const pdfs = robotsRules("User-agent: *\nDisallow: /*.pdf$\n");
    expect(robotsAllows(pdfs, "/menu.pdf")).toBe(false);
    expect(robotsAllows(pdfs, "/menu.pdf/page")).toBe(true);
    expect(robotsAllows(robotsRules(""), "/anything")).toBe(true);
  });
});

describe("paste your website: sign-up fills itself in", () => {
  const html = `<html><head><title>Caffè Aurora | Coffee &amp; cakes in Leith</title>
    <meta name="description" content="Family-run Italian café in Leith: espresso, fresh cakes and light lunches.">
    <meta property="og:site_name" content="Caffè Aurora"></head><body><h1>Caffè Aurora</h1></body></html>`;

  it("name, description, @address and picture from the homepage", () => {
    expect(homePreview(html, new URL("https://www.caffe-aurora.co.uk/"))).toEqual({
      name: "Caffè Aurora",
      description: "Family-run Italian café in Leith: espresso, fresh cakes and light lunches.",
      handle: "caffe_aurora",
      avatar: "☕",
      domain: "caffe-aurora.co.uk",
    });
  });

  it("the name comes from the title when there's no site name", () => {
    expect(homePreview("<title>Home | Trattoria da Luca – Camden</title>", new URL("https://t.example/")).name).toBe("Trattoria da Luca");
  });

  it("pictures follow what the business does (accents included)", () => {
    expect(avatarFor("Best pizza in town")).toBe("🍕");
    expect(avatarFor("A small café")).toBe("☕");
    expect(avatarFor("Barbers in Leith")).toBe("💇");
    expect(avatarFor("Smart party planning")).toBe("🏪");
    expect(handleFromDomain("ab.example")).toBe("");
  });
});

describe("paste your website: what changed, and who owns it", () => {
  it("lists added and removed lines, ignoring dates and cookie notices", () => {
    const before = "Open Mon–Sat\n© 2025 Aurora\nTiramisù £4.50\nWe use cookies";
    const after = "Open Tue–Sun\n© 2026 Aurora\nTiramisù £4.50\nWe use cookies to improve";
    expect(changedLines(before, after)).toEqual({ added: ["Open Tue–Sun"], removed: ["Open Mon–Sat"] });
    expect(mockChanges(["Open Tue–Sun"], [])).toBe("Your website now says: “Open Tue–Sun”.");
    expect(mockChanges([], [])).toBe("NONE");
  });

  it("verifies by email only at the website's own domain (not free mail or shared endings)", () => {
    expect(verifiesByEmail("luca@trattoria.co.uk", "trattoria.co.uk")).toBe(true);
    expect(verifiesByEmail("luca@mail.trattoria.co.uk", "www.trattoria.co.uk")).toBe(true);
    expect(verifiesByEmail("luca@gmail.com", "gmail.com")).toBe(false);
    expect(verifiesByEmail("luca@hotmail.com", "trattoria.co.uk")).toBe(false);
    expect(verifiesByEmail("luca@x.co.uk", "co.uk")).toBe(false);
    expect(verifiesByEmail("luca@nottrattoria.co.uk", "trattoria.co.uk")).toBe(false);
    expect(verifiesByEmail(null, "trattoria.co.uk")).toBe(false);
  });

  it("verifies by the meta tag on the homepage (either attribute order)", () => {
    expect(hasVerifyToken(`<head>${verifyTag("abc123")}</head>`, "abc123")).toBe(true);
    expect(hasVerifyToken(`<meta content="abc123" name="agentme-verify" />`, "abc123")).toBe(true);
    expect(hasVerifyToken(`<meta name="agentme-verify" content="nope">`, "abc123")).toBe(false);
    expect(hasVerifyToken(`<meta name="agentme-verify" content="">`, "")).toBe(false);
  });

  it("short addresses for citations", () => {
    expect(shortUrl("https://www.a.example/menu/")).toBe("a.example/menu");
    expect(shortUrl("https://a.example/")).toBe("a.example");
    expect(shortUrl("http://localhost:3000/demo/site/faq.html")).toBe("localhost/demo/site/faq.html");
  });
});

const pages = [
  { url: "https://aurora.example/", title: "Caffè Aurora", text: "Caffè Aurora | Coffee & cakes in Leith\nFamily-run Italian café in Leith, serving espresso, fresh cakes and light lunches since 2009." },
  { url: "https://aurora.example/menu", title: "Menu", text: "Menu\n- Espresso £2.20\n- Tiramisù £4.50" },
  { url: "https://aurora.example/visit", title: "Visit us", text: "Opening hours: Mon–Sat 8:00–17:00, closed Sundays\nAddress: 12 Shore Street, Leith, Edinburgh EH6 6QW\nPhone: 0131 555 0199\nEmail: ciao@aurora.example" },
  { url: "https://aurora.example/faq", title: "FAQ", text: "Do you have oat milk?\nYes, oat and almond milk at no extra charge." },
];

describe("what the agent learned", () => {
  it("the stand-in copies what's on the pages and never invents", () => {
    const learned = mockLearn(pages);
    expect(learned.summary).toBe("Family-run Italian café in Leith, serving espresso, fresh cakes and light lunches since 2009.");
    expect(learned.hours).toBe("Opening hours: Mon–Sat 8:00–17:00, closed Sundays");
    expect(learned.address).toBe("Address: 12 Shore Street, Leith, Edinburgh EH6 6QW");
    expect(learned.phone).toBe("0131 555 0199");
    expect(learned.email).toBe("ciao@aurora.example");
    expect(learned.facts.map((f) => f.value)).toEqual(["Espresso £2.20", "Tiramisù £4.50"]);
    expect(learned.faqs[0]).toEqual({ q: "Do you have oat milk?", a: "Yes, oat and almond milk at no extra charge.", source: "https://aurora.example/faq" });
  });

  it("what the model wrote is trimmed, de-duplicated, and only cites the website's own pages", () => {
    const learned = clampLearned(
      {
        summary: "  A café.  ",
        hours: "x".repeat(500),
        address: "",
        phone: "",
        email: "",
        facts: [
          { label: "Prices", value: "Espresso £2.20", source: "https://aurora.example/menu" },
          { label: "prices", value: "Again", source: "https://aurora.example/menu" },
          { label: "Parking", value: "Free", source: "https://evil.example/" },
          { label: "", value: "No label", source: "" },
        ],
        faqs: [{ q: "Dogs?", a: "Yes.", source: "https://aurora.example/faq" }],
      },
      pages.map((p) => p.url),
    );
    expect(learned.summary).toBe("A café.");
    expect(learned.hours).toHaveLength(300);
    expect(learned.facts).toEqual([
      { label: "Prices", value: "Espresso £2.20", source: "https://aurora.example/menu" },
      { label: "Parking", value: "Free", source: "" },
    ]);
  });

  it("removed items aren't used; the rest is what the agent answers from", () => {
    const learned: Learned = { ...mockLearn(pages) };
    const hidden = [itemKey.basic("phone"), itemKey.fact(learned.facts[0].label)];
    const text = learnedText(learned, hidden);
    expect(text).toContain("Opening hours: Opening hours: Mon–Sat");
    expect(text).not.toContain("0131 555 0199");
    expect(text).not.toContain("Espresso £2.20");
    expect(text).toContain("Q: Do you have oat milk?\nA: Yes, oat and almond milk at no extra charge. (aurora.example/faq)");
    expect(learnedCount(learned, hidden)).toBe(learnedCount(learned, []) - 2);
  });

  it("three likely questions to try it as a customer", () => {
    expect(tryQuestions(mockLearn(pages))).toEqual(["Do you have oat milk?", "When are you open?", "Where are you?"]);
    expect(tryQuestions({ summary: "", hours: "", address: "", phone: "", email: "", facts: [], faqs: [] })).toEqual(["What do you offer?"]);
  });

  it("every website answer says which page and when it was checked", () => {
    const now = Date.parse("2026-11-09T20:00:00Z");
    expect(citation("https://www.aurora.example/menu", "2026-11-09T10:00:00Z", now)).toBe("📄 From aurora.example/menu · checked today");
    expect(citation("https://aurora.example/menu", "2026-11-08T10:00:00Z", now)).toBe("📄 From aurora.example/menu · checked yesterday");
    expect(citation("https://aurora.example/menu", "2026-11-04T10:00:00Z", now)).toBe("📄 From aurora.example/menu · checked 4 Nov");
  });
});

describe("answering from a big website", () => {
  it("words are compared roughly singular", () => {
    expect(terms("Prices and parking boxes, glass menus")).toEqual(["price", "park", "box", "glass", "menu"]);
  });

  it("only the parts of the pages that match the question are sent", () => {
    const filler = Array.from({ length: 40 }, (_, i) => `Our story, chapter ${i}: we love making coffee for our neighbours every day.`).join("\n");
    const sources: KnowledgeSource[] = [
      { url: "https://a.example/about", visibility: "public", content: filler, last_read_at: null, origin: "site" },
      { url: "https://a.example/visit", visibility: "public", content: `${filler}\nParking: free car park behind the café, 20 spaces.`, last_read_at: null, origin: "site" },
    ];
    const picked = pickRelevant(sources, "Is there parking?", 1300);
    expect(picked.map((s) => s.url)).toEqual(["https://a.example/visit"]);
    expect(picked[0].content).toContain("free car park");
  });

  it("the owner's corrections come with their own words, and win", () => {
    const { info } = businessKnowledge(
      { display_name: "Aurora", handle: "aurora", business_info: { about: "A café.", corrections: [{ label: "Opening hours", value: "Closed on Mondays from December" }] } },
      [],
      "public",
    );
    expect(info).toContain("Corrections by the owner (right even where the website says otherwise):\n- Opening hours: Closed on Mondays from December");
  });

  it("the reviewed summary always comes first, before any page", () => {
    const { websites } = businessKnowledge({ display_name: "Aurora", handle: "aurora", business_info: {} }, [
      { url: "https://a.example/menu", visibility: "public", content: "Espresso £2.20", last_read_at: "2026-11-09T10:00:00Z", origin: "site" },
      { url: "https://a.example/", visibility: "public", content: "Opening hours: Mon–Sat", last_read_at: null, origin: "learned" },
    ], "public", "espresso");
    expect(websites.indexOf("summary of the website")).toBeLessThan(websites.indexOf("Espresso £2.20"));
  });
});

describe("questions your website doesn't answer", () => {
  const at = (h: number) => new Date(Date.UTC(2026, 10, 9, h)).toISOString();
  it("groups what customers asked by topic, biggest first, in their words", () => {
    const gaps = groupQuestions([
      { id: "1", question: "Is there parking nearby?", created_at: at(9) },
      { id: "2", question: "Do you sell gift cards?", created_at: at(10) },
      { id: "3", question: "Where can I park?", created_at: at(11) },
      { id: "4", question: "Do you have parking for vans?", created_at: at(12) },
    ]);
    expect(gaps.map((g) => g.items.map((i) => i.id))).toEqual([["4", "3", "1"], ["2"]]);
    expect(gapTitle(gaps[0])).toBe("3 customers asked about parking");
    expect(gapTitle(gaps[1])).toBe("A customer asked: “Do you sell gift cards?”");
  });
});

describe("test stand-in: where an answer came from", () => {
  it("names the page, even when the reviewed summary repeats the same sentence first", async () => {
    const { mockSourceOf } = await import("@/lib/llm/mock");
    const knowledge = [
      "Business: Aurora",
      "<website_content>",
      "From https://a.example/ (summary of the website, reviewed by the owner):",
      "Q: Do you have oat milk?\nA: Yes, oat and almond milk. (a.example/faq)",
      "From https://a.example/faq (read 2026-11-09):",
      "Yes, oat and almond milk.",
      "</website_content>",
    ].join("\n");
    expect(mockSourceOf("Yes, oat and almond milk.", knowledge)).toBe("https://a.example/faq");
    expect(mockSourceOf("Business: Aurora", knowledge)).toBe("");
  });
});
