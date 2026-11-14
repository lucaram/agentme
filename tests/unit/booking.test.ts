import { describe, expect, it } from "vitest";
import { normaliseWay, providerOf, wantsToBookOrOrder, wayHref, wayLabel, waysOf, waysText, waysForQuestion, withWays } from "@/lib/business/booking";

const ok = (kind: string, value: string) => {
  const r = normaliseWay(kind, value);
  if (!r.ok) throw new Error(r.error);
  return r.way;
};

describe("how customers book or order", () => {
  it("tidies links, phones, WhatsApp and email", () => {
    expect(ok("book", "opentable.co.uk/r/sole")).toEqual({ kind: "book", value: "https://opentable.co.uk/r/sole" });
    expect(ok("call", " 020 7946  0000 ")).toEqual({ kind: "call", value: "020 7946 0000" });
    expect(ok("whatsapp", "+44 7700 900123")).toEqual({ kind: "whatsapp", value: "https://wa.me/447700900123" });
    expect(ok("whatsapp", "https://wa.me/447700900123")).toEqual({ kind: "whatsapp", value: "https://wa.me/447700900123" });
    expect(ok("email", "Hello@Sole.example")).toEqual({ kind: "email", value: "hello@sole.example" });
  });

  it("only ever produces http(s), tel, wa.me and mailto", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,hi", "ftp://x.example", "https://user:pw@x.example", "localhost"]) {
      expect(normaliseWay("book", bad).ok, bad).toBe(false);
    }
    expect(normaliseWay("call", "call me maybe").ok).toBe(false);
    expect(normaliseWay("email", "not-an-email").ok).toBe(false);
    expect(normaliseWay("payments", "https://x.example").ok).toBe(false);
    expect(wayHref(ok("call", "+44 20 7946 0000"))).toBe("tel:+442079460000");
    expect(wayHref(ok("email", "a@b.example"))).toBe("mailto:a@b.example");
  });

  it("recognises well-known services for the button label", () => {
    expect(providerOf(ok("book", "https://www.opentable.co.uk/r/sole"))).toBe("OpenTable");
    expect(wayLabel(ok("book", "https://www.fresha.com/a/salon"))).toBe("📅 Book on Fresha");
    expect(wayLabel(ok("order", "https://deliveroo.co.uk/menu/x"))).toBe("🛍️ Order on Deliveroo");
    expect(wayLabel(ok("book", "https://sole.example/book"))).toBe("📅 Book online");
    expect(wayLabel(ok("website", "https://www.sole.example/"))).toBe("🔗 sole.example");
    expect(wayLabel(ok("call", "020 7946 0000"))).toBe("📞 Call 020 7946 0000");
  });

  it("re-checks stored ways (never trusts them blindly)", () => {
    expect(waysOf({ ways: [{ kind: "book", value: "javascript:alert(1)" }, { kind: "call", value: "020 7946 0000" }, "junk", null] })).toEqual([{ kind: "call", value: "020 7946 0000" }]);
    expect(waysOf(null)).toEqual([]);
  });

  it("round-trips more than six actions, repeated types, custom labels and featured choices", () => {
    const list = Array.from({ length: 8 }, (_, i) => ({ kind: "book", value: `https://sole.example/book/${i}`, label: `Book option ${i}`, primary: i === 7 }));
    expect(waysOf({ ways: list })).toEqual(list);
    const custom = normaliseWay("custom", "sole.example/catering", { label: "Request catering", purpose: "book", primary: true });
    expect(custom).toEqual({ ok: true, way: { kind: "custom", value: "https://sole.example/catering", label: "Request catering", purpose: "book", primary: true } });
    if (!custom.ok) return;
    expect(wayLabel(custom.way)).toContain("Request catering");
    expect(waysText([custom.way])).toContain("Request catering: https://sole.example/catering (book)");
    expect(normaliseWay("custom", "https://sole.example", { purpose: "book" }).ok).toBe(false);
    expect(normaliseWay("custom", "javascript:alert(1)", { label: "Book", purpose: "book" }).ok).toBe(false);
  });

  it("keeps custom action purposes relevant to the user's question", () => {
    const all = waysOf({ ways: [
      { kind: "custom", value: "https://sole.example/events", label: "Private events", purpose: "book" },
      { kind: "custom", value: "https://sole.example/brochure", label: "Download brochure", purpose: "information" },
      { kind: "order", value: "https://sole.example/order" },
    ] });
    expect(waysForQuestion("Can I book a table?", all).map((way) => way.value)).toEqual(["https://sole.example/events"]);
    expect(waysForQuestion("Can I see the brochure?", all).map((way) => way.value)).toEqual(["https://sole.example/brochure"]);
    expect(withWays("Can I see the brochure?", { answer: "Unknown", needs_team: true }, all)).toMatchObject({ needs_team: false, answer: expect.stringContaining("https://sole.example/brochure") });
    expect(withWays("Can I see the brochure?", { answer: "Our brochure is available online.", needs_team: false }, all).answer).toContain("Options for this request:");
  });

  it("booking questions always get the business's own ways, and never go to the team", () => {
    const ways = [ok("book", "https://sole.example/book")];
    expect(wantsToBookOrOrder("Can I book a table for 4?")).toBe(true);
    expect(wantsToBookOrOrder("Do you have vegetarian options?")).toBe(false);
    expect(withWays("Can I book a table?", { answer: "I don't have that.", needs_team: true }, ways)).toEqual({
      answer: "I can't book or take orders myself, but you can here:\n📅 Book online: https://sole.example/book",
      needs_team: false,
    });
    expect(withWays("Can I order takeaway?", { answer: "Yes, we do takeaway.", needs_team: false }, ways).answer).toContain("https://sole.example/book");
    const asked = { answer: "Yes, about half the menu.", needs_team: false };
    expect(withWays("Vegetarian options?", asked, ways)).toBe(asked);
    expect(withWays("Can I book?", { answer: "x", needs_team: true }, [])).toEqual({ answer: "x", needs_team: true });
  });
});
