import { describe, expect, it } from "vitest";
import { anchorsOnPage, detectSearch, pageLang, searchAddress, searchCandidates } from "@/lib/business/site-search";
import { rankIndexHits } from "@/lib/business/site";
import { terms } from "@/lib/business/knowledge";

const BASE = new URL("https://www.example.it/");

describe("a website's own search box (found when the site is read)", () => {
  it("from what the site declares to search engines", () => {
    const html = `<script type="application/ld+json">{"@type":"WebSite","potentialAction":{"@type":"SearchAction","target":"https:\\/\\/www.example.it\\/cerca?q={search_term_string}","query-input":"required name=search_term_string"}}</script>`;
    expect(detectSearch(html, BASE)).toBe("https://www.example.it/cerca?q={q}");
    const nested = `{"potentialAction":{"@type":"SearchAction","target":{"@type":"EntryPoint","urlTemplate":"https://www.example.it/search/{query}/"}}}`;
    expect(detectSearch(nested, BASE)).toBe("https://www.example.it/search/{q}/");
  });

  it("from its search form, with the fixed fields it sends along", () => {
    const form = `<form action="/ricerca/" onsubmit="return check();"><input id="chiave" aria-label="Cerca nel sito" name="q" value="Cerca..."></form>`;
    expect(detectSearch(form, BASE)).toBe("https://www.example.it/ricerca/?q={q}");
    const shop = `<form role="search" method="get" action="https://www.example.it/"><input type="search" name="s"><input type="hidden" name="post_type" value="product"></form>`;
    expect(detectSearch(shop, BASE)).toBe("https://www.example.it/?post_type=product&s={q}");
  });

  it("not a login, newsletter or posted form, and never another website's search", () => {
    expect(detectSearch(`<form method="post" action="/login"><input name="q"><input type="password" name="p"></form>`, BASE)).toBeNull();
    expect(detectSearch(`<form action="/newsletter"><input type="email" name="email"><input name="q"></form>`, BASE)).toBeNull();
    expect(detectSearch(`<form action="https://www.google.com/search"><input name="q"></form>`, BASE)).toBeNull();
    expect(detectSearch(`<form action="/contact"><input name="name"><input name="message"></form>`, BASE)).toBeNull();
    expect(detectSearch("<p>No search here</p>", BASE)).toBeNull();
  });

  it("WordPress sites always have one", () => {
    expect(detectSearch(`<meta name="generator" content="WordPress 6.8">`, BASE)).toBe("https://www.example.it/?s={q}");
  });

  it("the words go into the address safely", () => {
    expect(searchAddress("https://www.example.it/ricerca/?q={q}", "recensione zelda & ocarina")).toBe("https://www.example.it/ricerca/?q=recensione%20zelda%20%26%20ocarina");
  });

  it("knows the site's language", () => {
    expect(pageLang(`<!doctype html><html lang="it-IT" class="x">`)).toBe("it");
    expect(pageLang(`<html lang='en'>`)).toBe("en");
    expect(pageLang("<html>")).toBeNull();
  });
});

describe("what a site's search returns is only a list of candidates", () => {
  const results = `
    <nav><a href="/">Home</a><a href="/recensioni/">Recensioni</a><a href="/login">Accedi</a></nav>
    <a href="/articoli/recensione-the-legend-of-zelda-ocarina-of-time-remake-67789.html"><img src="x.webp"><h2>The Legend of Zelda Ocarina of Time Remake Recensione</h2></a>
    <a href="/notizie/zelda-ocarina-of-time-remake-vendite-911250.html">Zelda Ocarina of Time Remake: 5 milioni di copie</a>
    <a href="/notizie/lego-set-sconti-911328.html">LEGO: conviene aspettare gli sconti?</a>
    <a href="/ricerca/?q=recensione zelda&pagina=2">2</a>
    <a href="https://other.example/zelda-ocarina-recensione">Altrove</a>`;
  const anchors = anchorsOnPage(results, BASE, "/");

  it("reads each link with its text; other websites and login pages are left out", () => {
    expect(anchors.map((a) => a.url)).toEqual([
      "https://www.example.it/",
      "https://www.example.it/recensioni/",
      "https://www.example.it/articoli/recensione-the-legend-of-zelda-ocarina-of-time-remake-67789.html",
      "https://www.example.it/notizie/zelda-ocarina-of-time-remake-vendite-911250.html",
      "https://www.example.it/notizie/lego-set-sconti-911328.html",
      "https://www.example.it/ricerca/",
    ]);
    expect(anchors[2].title).toBe("The Legend of Zelda Ocarina of Time Remake Recensione");
  });

  it("keeps the links that mention the words asked about, most words first; menus and 'next page' fall out", () => {
    const found = searchCandidates(anchors, "recensione zelda ocarina of time remake", "https://www.example.it/ricerca/?q=x");
    expect(found.map((a) => a.url)).toEqual([
      "https://www.example.it/articoli/recensione-the-legend-of-zelda-ocarina-of-time-remake-67789.html",
      "https://www.example.it/notizie/zelda-ocarina-of-time-remake-vendite-911250.html",
    ]);
    expect(searchCandidates(anchors, "parcheggio vicino", "https://www.example.it/ricerca/?q=x")).toEqual([]);
    expect(searchCandidates(anchors, "", "https://www.example.it/ricerca/?q=x")).toEqual([]);
  });
});

describe("matching by meaning: the question's words in the website's language", () => {
  it("the rewritten words find the page a question in another language would miss", () => {
    const rows = [
      { url: "/articoli/recensione-castlevania-nocturne.html", words: "articoli recensione castlevania nocturne", lastmod: null },
      { url: "/notizie/castlevania-nocturne-trailer.html", words: "notizie castlevania nocturne trailer", lastmod: null },
    ];
    // In English alone both pages match two words each: the review can't be told from the news.
    const english = [...new Set(terms("the review of Castlevania Nocturne"))];
    expect(rankIndexHits(english, rows).map((r) => r.url)).toHaveLength(2);
    // With the Italian words first, the review matches one more word and comes first.
    const both = [...new Set(terms("recensione castlevania nocturne the review of Castlevania Nocturne"))];
    expect(rankIndexHits(both, rows)[0].url).toBe("/articoli/recensione-castlevania-nocturne.html");
  });
});
