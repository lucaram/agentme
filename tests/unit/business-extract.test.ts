import { describe, expect, it } from "vitest";
import { checkUrl, htmlToText, isPublicAddress } from "@/lib/business/extract";

describe("reading a business's own pages safely", () => {
  it("accepts normal web addresses only", () => {
    expect(checkUrl("https://trattoriasole.co.uk/menu").ok).toBe(true);
    expect(checkUrl("ftp://example.com").ok).toBe(false);
    expect(checkUrl("https://user:pass@example.com").ok).toBe(false);
    expect(checkUrl("https://example.com:8443/x").ok).toBe(false);
    expect(checkUrl("http://intranet/menu").ok).toBe(false);
    expect(checkUrl("not a url").ok).toBe(false);
    // Development only: local pages on any port.
    expect(checkUrl("http://localhost:3000/demo/menu.html").ok).toBe(false);
    expect(checkUrl("http://localhost:3000/demo/menu.html", { allowLocal: true }).ok).toBe(true);
    expect(checkUrl("https://example.com:8443/x", { allowLocal: true }).ok).toBe(false);
  });

  it("never fetches internal addresses (loopback, private, cloud metadata)", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.3.4", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::6810:85e5"]) expect(isPublicAddress(ip), ip).toBe(true);
  });

  it("turns HTML into readable lines without scripts or styles", () => {
    const html = `<html><head><title>Trattoria Sole · Menu</title><style>.x{}</style></head><body>
      <h1>Menu</h1><script>alert(1)</script><ul><li>Margherita &pound;9</li><li>Tiramis&ugrave; &amp; coffee</li></ul>
      <table><tr><td>Wine</td><td>&#8364;6</td></tr></table><p>Open Tue&ndash;Sun</p></body></html>`;
    const text = htmlToText(html);
    expect(text).toContain("Trattoria Sole · Menu");
    expect(text).toContain("- Margherita £9");
    expect(text).toContain("Wine · €6");
    expect(text).toContain("Open Tue–Sun");
    expect(text).not.toContain("alert");
    expect(text).not.toContain(".x{}");
  });
});

describe("links written in the text", () => {
  it("finds addresses, drops trailing punctuation and repeats", async () => {
    const { linksIn, linkKey } = await import("@/lib/business/extract");
    expect(linksIn("Menu: https://pasta.example/menu. Again https://pasta.example/menu, and (http://x.example/a)")).toEqual([
      "https://pasta.example/menu",
      "http://x.example/a",
    ]);
    // Matches the stored link even when written slightly differently.
    expect(linkKey("HTTPS://Pasta.Example")).toBe(linkKey("https://pasta.example/"));
    expect(linkKey("not a url")).toBeNull();
  });
});
