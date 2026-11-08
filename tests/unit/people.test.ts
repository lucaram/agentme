import { describe, expect, it } from "vitest";
import { extractEntries, maskEmail, maskPhone, normaliseCountryCode, normaliseEmail, normalisePhone, toIdentifier } from "@/lib/people/normalise";
import { parseIntroduceCommand } from "@/lib/people/introductions";
import { safeNext } from "@/lib/next-path";

process.env.A2A_SIGNING_SECRET ??= "unit-test-secret-unit-test-secret-unit-test";
const { identifierHash, liveConnectToken, verifyLiveConnectToken, LIVE_CONNECT_SECONDS } = await import("@/lib/people/crypto");

describe("normalising what people type or export", () => {
  it("emails: trimmed, lower-cased, mailto: removed, invalid ones dropped", () => {
    expect(normaliseEmail("  Marco@Example.COM ")).toBe("marco@example.com");
    expect(normaliseEmail("mailto:eve@agentme.test")).toBe("eve@agentme.test");
    expect(normaliseEmail("not an email")).toBeNull();
    expect(normaliseEmail("a@b")).toBeNull();
  });

  it("phones: international format, with the default country for local numbers", () => {
    expect(normalisePhone("+44 7700 900123")).toBe("+447700900123");
    expect(normalisePhone("0044 (7700) 900-123")).toBe("+447700900123");
    expect(normalisePhone("07700 900123", "+44")).toBe("+447700900123");
    expect(normalisePhone("347 123 4567", "39")).toBe("+393471234567");
    expect(normalisePhone("07700 900123")).toBeNull(); // no country known
    expect(normalisePhone("+44 12")).toBeNull(); // too short
    expect(normalisePhone("call me")).toBeNull();
  });

  it("country codes", () => {
    expect(normaliseCountryCode("44")).toBe("+44");
    expect(normaliseCountryCode("+353")).toBe("+353");
    expect(normaliseCountryCode("0044")).toBe("+44");
    expect(normaliseCountryCode("")).toBeNull();
    expect(normaliseCountryCode("12345")).toBeNull();
  });

  it("the same person matches however their details were written", () => {
    expect(identifierHash(toIdentifier("MARCO@example.com")!)).toBe(identifierHash(toIdentifier("marco@example.com ")!));
    expect(identifierHash(toIdentifier("07700 900123", "+44")!)).toBe(identifierHash(toIdentifier("+447700900123")!));
    // An email and a phone never collide.
    expect(toIdentifier("+447700900123")?.kind).toBe("phone");
  });

  it("owners only see masked versions of their own details", () => {
    expect(maskEmail("luca_ram@hotmail.com")).toBe("l•••@hotmail.com");
    expect(maskPhone("+447700900123")).toBe("+44 ••• 0123");
  });
});

describe("reading an address book", () => {
  it("vCard (.vcf): only emails and phone numbers, names ignored, folded lines handled", () => {
    const vcf = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Marco Rossi",
      "TEL;TYPE=CELL:+39 347 123 4567",
      "item1.EMAIL;TYPE=INTERNET:marco@example.com",
      "NOTE:likes pizza",
      "END:VCARD",
      "BEGIN:VCARD",
      "FN:Paul",
      "EMAIL:paul@exa",
      " mple.com",
      "END:VCARD",
    ].join("\r\n");
    expect(extractEntries(vcf).sort()).toEqual(["+39 347 123 4567", "marco@example.com", "paul@example.com"]);
  });

  it("pasted text or CSV", () => {
    const text = "Marco, marco@example.com, +44 7700 900123\nEve <eve@agentme.test>\n07700 900456";
    expect(extractEntries(text).sort()).toEqual(["+44 7700 900123", "07700 900456", "eve@agentme.test", "marco@example.com"]);
  });
});

describe("live QR codes", () => {
  it("connect only for the agent they were made for, and only for 10 minutes", () => {
    const now = Date.UTC(2026, 10, 8, 9, 0);
    const { token } = liveConnectToken("agent-a", now);
    expect(verifyLiveConnectToken("agent-a", token, now + 60_000)).toBe(true);
    expect(verifyLiveConnectToken("agent-b", token, now)).toBe(false);
    expect(verifyLiveConnectToken("agent-a", token, now + (LIVE_CONNECT_SECONDS + 1) * 1000)).toBe(false);
    expect(verifyLiveConnectToken("agent-a", token.replace(/.$/, (c) => (c === "A" ? "B" : "A")), now)).toBe(false);
    expect(verifyLiveConnectToken("agent-a", "garbage", now)).toBe(false);
  });
});

describe("introduce command", () => {
  it("understands to / and / with, plus an optional note", () => {
    expect(parseIntroduceCommand("introduce @eve to @marco")).toEqual({ a: "eve", b: "marco", note: null });
    expect(parseIntroduceCommand("Introduce @Eve and @Marco - you both love climbing")).toEqual({ a: "eve", b: "marco", note: "you both love climbing" });
    expect(parseIntroduceCommand("dinner with @eve and @marco")).toBeNull();
  });
});

describe("redirects after sign-in", () => {
  it("only same-site paths", () => {
    expect(safeNext("/join/abc")).toBe("/join/abc");
    expect(safeNext("//evil.com")).toBe("/chats");
    expect(safeNext("/\\evil.com")).toBe("/chats");
    expect(safeNext("https://evil.com")).toBe("/chats");
    expect(safeNext(null, "")).toBe("");
  });
});

describe("country code for numbers saved without one", async () => {
  const { codeFromLanguage, codeFromTimeZone } = await import("@/lib/people/country");
  it("comes from where the device is (time zone), then its language", () => {
    expect(codeFromTimeZone("Europe/London")).toBe("+44");
    expect(codeFromTimeZone("America/Chicago")).toBe("+1");
    expect(codeFromTimeZone("Australia/Sydney")).toBe("+61");
    expect(codeFromTimeZone("Antarctica/Troll")).toBeNull();
    expect(codeFromLanguage("en-GB")).toBe("+44");
    expect(codeFromLanguage("it-IT")).toBe("+39");
    expect(codeFromLanguage("en")).toBeNull();
  });
});

describe("email contacts (Gmail / Outlook)", async () => {
  const { contactsFromGoogle, contactsFromGraph, providerForEmail, providerFromMx } = await import("@/lib/people/providers");
  it("keeps only names, emails and phone numbers, preferring Google's international form", () => {
    expect(
      contactsFromGoogle({
        connections: [
          { names: [{ displayName: "Marco Rossi" }], emailAddresses: [{ value: "marco@gmail.com" }], phoneNumbers: [{ value: "07700 900123", canonicalForm: "+447700900123" }] },
          { phoneNumbers: [{ value: "+39 347 123 4567" }] },
        ],
      }),
    ).toEqual([
      { name: "Marco Rossi", addresses: ["marco@gmail.com", "+447700900123"] },
      { name: null, addresses: ["+39 347 123 4567"] },
    ]);
    expect(
      contactsFromGraph({
        value: [{ displayName: "Paul", emailAddresses: [{ address: "paul@outlook.com" }], mobilePhone: "+44 7700 900456", homePhones: [], businessPhones: ["+44 20 7946 0000"] }],
      }),
    ).toEqual([{ name: "Paul", addresses: ["paul@outlook.com", "+44 7700 900456", "+44 20 7946 0000"] }]);
  });
  it("suggests the provider that matches your email", () => {
    expect(providerForEmail("luca@gmail.com")).toBe("google");
    expect(providerForEmail("luca_ram@hotmail.com")).toBe("microsoft");
    expect(providerForEmail("luca@outlook.it")).toBe("microsoft");
    expect(providerForEmail("luca@agentme.test")).toBeNull();
  });
  it("recognises work and company domains from their mail servers", () => {
    expect(providerFromMx(["aspmx.l.google.com.", "alt1.aspmx.l.google.com"])).toBe("google");
    expect(providerFromMx(["acme-co-uk.mail.protection.outlook.com"])).toBe("microsoft");
    expect(providerFromMx(["mx01.mail.icloud.com"])).toBeNull();
    expect(providerFromMx(["mx.acme.example"])).toBeNull();
    expect(providerFromMx([])).toBeNull();
  });
});

describe("demo seed", () => {
  it("hashes emails exactly like the app, so demo accounts are findable", async () => {
    const { createHmac } = await import("node:crypto");
    const key = createHmac("sha256", process.env.A2A_SIGNING_SECRET!).update("agentme:identifier:v1").digest();
    const seeded = createHmac("sha256", key).update("email:marco@agentme.test").digest("base64url");
    expect(seeded).toBe(identifierHash({ kind: "email", value: "marco@agentme.test" }));
  });
});
