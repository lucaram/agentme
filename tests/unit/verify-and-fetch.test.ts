import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emailProofEnforced, homepageToVerify, readFromSameSite } from "@/lib/business/verify";
import { hasVerifyToken, verifyTag } from "@/lib/business/site";
import { DEADLINE_MS, safeFetch } from "@/lib/business/fetch";

describe("✓ Verified: an email only proves a website where emails are really confirmed", () => {
  it("off unless the deployment says its sign-ups confirm their email", () => {
    expect(emailProofEnforced({})).toBe(false);
    expect(emailProofEnforced({ EMAIL_CONFIRMATION_ENFORCED: "" })).toBe(false);
    expect(emailProofEnforced({ EMAIL_CONFIRMATION_ENFORCED: "true" })).toBe(false);
    expect(emailProofEnforced({ EMAIL_CONFIRMATION_ENFORCED: "1" })).toBe(true);
  });
});

describe("✓ Verified: the code must be on the website's own homepage, read from that website", () => {
  it("the homepage (root) over https, whatever page of the site was pasted", () => {
    expect(homepageToVerify("https://www.trattoria.co.uk/menu/lunch?x=1")).toBe("https://www.trattoria.co.uk/");
    expect(homepageToVerify("https://sites.example.com/my-shop/")).toBe("https://sites.example.com/"); // not the page under a shared host
    expect(homepageToVerify("http://trattoria.co.uk/")).toBeNull();
    expect(homepageToVerify("http://localhost:3000/demo/site/index.html", { allowLocal: true })).toBe("http://localhost:3000/");
    expect(homepageToVerify("not a url")).toBeNull();
  });

  it("a page finally read from another website proves nothing about this one", () => {
    expect(readFromSameSite("https://www.trattoria.co.uk/", "trattoria.co.uk")).toBe(true);
    expect(readFromSameSite("https://trattoria.co.uk/home", "trattoria.co.uk")).toBe(true);
    // The homepage redirected to a page the claimant controls, which carries the code.
    const token = "tok_123";
    const attackerPage = `<head>${verifyTag(token)}</head>`;
    expect(hasVerifyToken(attackerPage, token)).toBe(true);
    expect(readFromSameSite("https://attacker.example/landing", "trattoria.co.uk")).toBe(false);
    expect(readFromSameSite("https://trattoria.co.uk.attacker.example/", "trattoria.co.uk")).toBe(false);
    expect(readFromSameSite("https://shop.trattoria.co.uk/", "trattoria.co.uk")).toBe(false);
    expect(readFromSameSite("nonsense", "trattoria.co.uk")).toBe(false);
  });
});

describe("downloads have an absolute deadline", () => {
  let server: http.Server;
  let base = "";
  let redirectClosed = false;
  const before = process.env.ALLOW_LOCAL_FETCH;

  beforeAll(async () => {
    process.env.ALLOW_LOCAL_FETCH = "1"; // tests only: lets the reader fetch from this machine
    server = http.createServer((req, res) => {
      if (req.url === "/fast") {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end("<p>hello</p>");
      }
      if (req.url === "/hop-stream") {
        // A redirect whose own body never ends.
        res.writeHead(302, { location: "/fast", "content-type": "text/html" });
        const timer = setInterval(() => res.write("."), 50);
        res.on("close", () => {
          clearInterval(timer);
          redirectClosed = true;
        });
        return;
      }
      if (req.url === "/hop") {
        res.writeHead(302, { location: "/drip" });
        return res.end();
      }
      // A byte every 100 ms, for ever: never idle for long, never finished.
      res.writeHead(200, { "content-type": "text/html" });
      const timer = setInterval(() => res.write("."), 100);
      res.on("close", () => clearInterval(timer));
    });
    // "localhost" is the one local name the reader accepts (tests only), on any port.
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (before === undefined) delete process.env.ALLOW_LOCAL_FETCH;
    else process.env.ALLOW_LOCAL_FETCH = before;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it("an ordinary page is read", async () => {
    const page = await safeFetch(`${base}/fast`);
    expect(page.body.toString()).toBe("<p>hello</p>");
    expect(DEADLINE_MS).toBeLessThanOrEqual(30_000);
  });

  it("a server that trickles bytes is cut off at the deadline, not kept open by the idle timeout", async () => {
    const started = Date.now();
    await expect(safeFetch(`${base}/drip`, 0, Date.now() + 700)).rejects.toThrow("took too long");
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("a redirect is closed before the next address is read: it can't keep streaming behind the answer", async () => {
    redirectClosed = false;
    const page = await safeFetch(`${base}/hop-stream`);
    expect(page.body.toString()).toBe("<p>hello</p>");
    // The destination answered; the redirect's connection must be gone too (not left draining).
    for (let i = 0; i < 20 && !redirectClosed; i++) await new Promise((r) => setTimeout(r, 50));
    expect(redirectClosed).toBe(true);
  });

  it("the deadline covers redirects too", async () => {
    const started = Date.now();
    await expect(safeFetch(`${base}/hop`, 0, Date.now() + 700)).rejects.toThrow("took too long");
    expect(Date.now() - started).toBeLessThan(3000);
    await expect(safeFetch(`${base}/fast`, 0, Date.now() - 1)).rejects.toThrow("took too long");
  });
});
