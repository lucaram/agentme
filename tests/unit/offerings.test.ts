import { describe, expect, it } from "vitest";
import { facilityNote, mentionsOfferings, mockOfferings, offeringsKnowledge, planPrices, priceNote, sourceLabel, type FacilityRow, type PriceRow } from "@/lib/business/offerings-shared";
import { splitSource } from "@/lib/compare/comparison";

const NOW = Date.parse("2026-11-18T12:00:00Z");
const row = (p: Partial<PriceRow>): PriceRow => ({ id: crypto.randomUUID(), item: "Margherita pizza", variant: "12-inch", price: 8.5, currency: "GBP", source_url: "https://sole.example/menu.pdf", source_label: "menu.pdf", visibility: "public", found_price: 8.5, corrected: false, added: false, hidden: false, read_at: "2026-11-18T08:00:00Z", ...p });
const facility = (f: Partial<FacilityRow>): FacilityRow => ({ key: "parking", status: "yes", evidence: "free car park behind the restaurant", source_url: "https://sole.example/visit", source_label: "sole.example/visit", visibility: "public", confirmed: false, updated_at: "2026-11-16T08:00:00Z", ...f });

describe("prices & facilities", () => {
  it("a fresh read updates prices, keeps the business's corrections, and drops what the document no longer lists", () => {
    const plain = row({ item: "Margherita pizza" });
    const corrected = row({ item: "Diavola", variant: null, price: 10, found_price: 9.5, corrected: true });
    const gone = row({ item: "Calzone", variant: null });
    const goneCorrected = row({ item: "Lasagne", variant: null, corrected: true });
    const plan = planPrices([plain, corrected, gone, goneCorrected], [
      { item: "Margherita Pizza", variant: "12-inch", price: 9, currency: "gbp" },
      { item: "Diavola", variant: null, price: 11, currency: "GBP" },
      { item: "Tiramisù", variant: null, price: 6, currency: "GBP" },
    ], "2026-11-18T09:00:00Z");
    expect(plan.insert).toEqual([{ item: "Tiramisù", variant: null, price: 6, currency: "GBP" }]);
    expect(plan.update).toEqual(expect.arrayContaining([
      { id: plain.id, patch: { price: 9, currency: "GBP", found_price: 9, read_at: "2026-11-18T09:00:00Z" } },
      { id: corrected.id, patch: { found_price: 11, read_at: "2026-11-18T09:00:00Z" } },
      { id: goneCorrected.id, patch: { added: true, source_url: null, source_label: null } },
    ]));
    expect(plan.remove).toEqual([gone.id]);
  });

  it("says where each fact comes from", () => {
    expect(sourceLabel("https://www.sole.example/files/Menu%20Autumn.pdf")).toBe("Menu Autumn.pdf");
    expect(sourceLabel("https://sole.example/visit-us/")).toBe("sole.example/visit-us");
    expect(priceNote(row({}), NOW)).toBe("from menu.pdf, read today");
    expect(priceNote(row({ corrected: true }), NOW)).toBe("confirmed by the business");
    expect(priceNote(row({ added: true, source_label: null }), NOW)).toBe("confirmed by the business");
    expect(facilityNote(facility({}), NOW)).toBe("from sole.example/visit, read 16 Nov");
    expect(facilityNote(facility({ confirmed: true }), NOW)).toBe("confirmed by the business");
  });

  it("the agent knows only what this audience may see, never what's hidden", () => {
    const prices = [row({}), row({ item: "Staff menu", variant: null, price: 5, visibility: "customers" }), row({ item: "Old special", variant: null, hidden: true })];
    const facilities = [facility({}), facility({ key: "dog_friendly", status: "no", evidence: null, confirmed: true })];
    const publicView = offeringsKnowledge(prices, facilities, "public", NOW);
    expect(publicView).toContain("- Margherita pizza (12-inch): £8.50 (from menu.pdf, read today)");
    expect(publicView).toContain("- Parking: yes, free car park behind the restaurant (from sole.example/visit, read 16 Nov)");
    expect(publicView).toContain("- Dog-friendly: no (confirmed by the business)");
    expect(publicView).not.toContain("Staff menu");
    expect(publicView).not.toContain("Old special");
    expect(offeringsKnowledge(prices, facilities, "customers", NOW)).toContain("Staff menu");
    expect(offeringsKnowledge([], [], "public", NOW)).toBe("");
  });

  it("an answer's note becomes the comparison card's source", () => {
    expect(splitSource("A margherita is £8.50 (from menu.pdf, read today)")).toEqual({ text: "A margherita is £8.50", source: "menu.pdf, read today" });
    expect(splitSource("Yes, we have parking (confirmed by the business).")).toEqual({ text: "Yes, we have parking", source: "confirmed by the business" });
  });

  it("only pages that mention prices or facilities are read; the test stand-in reads simple menus", () => {
    expect(mentionsOfferings("About us: a family restaurant since 1987.")).toBe(false);
    expect(mentionsOfferings("Margherita £8.50")).toBe(true);
    expect(mentionsOfferings("Free car park behind the restaurant.")).toBe(true);
    expect(mockOfferings("Menu\nMargherita pizza (12-inch) £8.50\nTiramisù £6\nFree car park behind the restaurant. Dogs welcome.")).toEqual({
      prices: [{ item: "Margherita pizza", variant: "12-inch", price: 8.5, currency: "GBP" }, { item: "Tiramisù", variant: null, price: 6, currency: "GBP" }],
      facilities: [{ key: "parking", status: "yes", evidence: "Free car park behind the restaurant" }, { key: "dog_friendly", status: "yes", evidence: "Dogs welcome" }],
    });
  });
});
