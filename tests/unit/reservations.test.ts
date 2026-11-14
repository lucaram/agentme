import { describe, expect, it } from "vitest";
import { reservationDirections, reservationWays } from "@/lib/business/reservations";

const site = { url: "https://sole.example/", live_at: "2026-11-14", hidden: [] as string[], learned: { phone: "020 1111 1111", email: "site@sole.example", faqs: [{ q: "How do I reserve?", a: "Book online at https://sole.example/reservations", source: "https://sole.example/contact" }] } };
describe("published reservation options", () => {
  it("prefers the business's explicit options over the website and drops ordering links", () => {
    const ways = reservationWays({ ways: [{ kind: "call", value: "020 7946 0000" }, { kind: "book", value: "https://sole.example/book" }, { kind: "order", value: "https://delivery.example/" }] }, site);
    expect(ways).toEqual([{ kind: "call", value: "020 7946 0000" }, { kind: "book", value: "https://sole.example/book" }, { kind: "email", value: "site@sole.example" }]);
  });
  it("reads public booking FAQs such as the seeded business's phone instruction", () => {
    const ways = reservationWays({ faqs: [{ q: "Do you take group bookings?", a: "Up to 12. Please call 020 7946 0000 or email bookings@sole.example to book." }] });
    expect(ways).toEqual([{ kind: "call", value: "020 7946 0000" }, { kind: "email", value: "bookings@sole.example" }]);
    expect(reservationDirections(ways)).toBe("To arrange one, use the options below.");
  });
  it("never uses unpublished/hidden website details or customers-only information", () => {
    expect(reservationWays({ customers: "Call 020 9999 9999 or email private@sole.example." }, { ...site, live_at: null })).toEqual([]);
    const ways = reservationWays({}, { ...site, hidden: ["basic:phone", "basic:email", "faq:how do i reserve?"] });
    expect(ways).toEqual([{ kind: "website", value: "https://sole.example/" }]);
    expect(reservationDirections(ways)).toBe("To arrange one, use the options below.");
    expect(reservationDirections(ways)).not.toContain("book online");
  });
  it("honours owner corrections and validates every extracted contact/link", () => {
    const ways = reservationWays({ corrections: [{ label: "Phone", value: "020 2222 2222" }], faqs: [{ q: "How to book?", a: "Book online at javascript:alert(1). Your reference is 1234567890." }] }, site);
    expect(ways).toContainEqual({ kind: "call", value: "020 2222 2222" });
    expect(JSON.stringify(ways)).not.toMatch(/1111|javascript|1234567890/);
    expect(reservationDirections([])).toContain("No booking contact details are published");
  });

  it("preserves every reservation option and repeated phone types while excluding informational custom buttons", () => {
    const actions = [
      ...Array.from({ length: 7 }, (_, i) => ({ kind: "book", value: `https://sole.example/book/${i}` })),
      { kind: "call", value: "020 1111 1111" }, { kind: "call", value: "020 2222 2222" },
      { kind: "custom", value: "https://sole.example/brochure", label: "Brochure", purpose: "information" },
      { kind: "custom", value: "https://sole.example/room", label: "Private room", purpose: "book" },
    ];
    const result = reservationWays({ ways: actions });
    expect(result).toHaveLength(10);
    expect(result.filter((way) => way.kind === "call")).toHaveLength(2);
    expect(result.some((way) => way.label === "Brochure")).toBe(false);
    expect(result.at(-1)?.label).toBe("Private room");
  });
});
