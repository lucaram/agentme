import { describe, expect, it } from "vitest";
import {
  cleanTags, facilityNote, groupItems, mentionsOfferings, mockOfferings, offeringsKnowledge, planPrices, priceNote, priceText, sourceLabel,
  type FacilityRow, type FoundItem, type PriceRow,
} from "@/lib/business/offerings-shared";
import { splitSource, summarise, type Comparison } from "@/lib/compare/comparison";

const NOW = Date.parse("2026-11-18T12:00:00Z");
const row = (p: Partial<PriceRow>): PriceRow => ({
  id: crypto.randomUUID(), group_id: "g-margherita", kind: "product", category: "Pizza", item: "Margherita pizza", variant: "12-inch", description: null, tags: [],
  price_type: "fixed", price: 8.5, currency: "GBP", duration_minutes: null, needs_booking: false, source_url: "https://sole.example/menu.pdf", source_label: "menu.pdf",
  visibility: "public", found_price: 8.5, found_item: "Margherita pizza", corrected: false, added: false, hidden: false, read_at: "2026-11-18T08:00:00Z", ...p,
});
const found = (p: Partial<FoundItem>): FoundItem => ({ kind: "product", category: "Pizza", item: "Margherita pizza", description: null, tags: [], price_type: "fixed", duration_minutes: null, needs_booking: false, currency: "GBP", options: [{ label: null, price: 1 }], ...p });
const facility = (f: Partial<FacilityRow>): FacilityRow => ({ key: "parking", label: null, status: "yes", evidence: "free car park behind the restaurant", source_url: "https://sole.example/visit", source_label: "sole.example/visit", visibility: "public", confirmed: false, hidden: false, updated_at: "2026-11-16T08:00:00Z", ...f });

describe("products & services", () => {
  it("a fresh read updates options, adds new ones to their item, keeps the business's changes, and drops what's gone", () => {
    const plain = row({});
    const renamed = row({ group_id: "g-diavola", item: "Diavola (house special)", found_item: "Diavola", variant: null, price: 10, found_price: 9.5, corrected: true });
    const gone = row({ group_id: "g-calzone", item: "Calzone", found_item: "Calzone", variant: null });
    const goneChanged = row({ group_id: "g-lasagne", item: "Lasagne", found_item: "Lasagne", variant: null, corrected: true });
    const plan = planPrices([plain, renamed, gone, goneChanged], [
      found({ item: "Margherita Pizza", tags: ["vegetarian"], options: [{ label: "12-inch", price: 9 }, { label: "10-inch", price: 7.5 }] }),
      found({ item: "Diavola", options: [{ label: null, price: 11 }] }),
      found({ kind: "service", category: null, item: "Room hire", price_type: "from", duration_minutes: 120, needs_booking: true, options: [{ label: null, price: 150 }] }),
    ], "2026-11-18T09:00:00Z");
    // The 10-inch joins the Margherita it belongs to; Room hire is new; the renamed Diavola is still recognised.
    expect(plan.insert).toEqual([
      expect.objectContaining({ item: "Margherita Pizza", group_id: "g-margherita", variant: "10-inch", price: 7.5, tags: ["Vegetarian"], found_item: "Margherita Pizza" }),
      expect.objectContaining({ kind: "service", item: "Room hire", group_id: null, price_type: "from", duration_minutes: 120, needs_booking: true, price: 150 }),
    ]);
    expect(plan.update).toEqual(expect.arrayContaining([
      { id: plain.id, patch: expect.objectContaining({ price: 9, found_price: 9, tags: ["Vegetarian"], read_at: "2026-11-18T09:00:00Z" }) },
      { id: renamed.id, patch: { found_price: 11, read_at: "2026-11-18T09:00:00Z" } },
      { id: goneChanged.id, patch: { added: true, source_url: null, source_label: null } },
    ]));
    expect(plan.remove).toEqual([gone.id]);
  });

  it("groups options into items, and writes prices the way they're given", () => {
    const items = groupItems([row({ variant: "12-inch", price: 8.5 }), row({ variant: "10-inch", price: 7.5, corrected: true }), row({ group_id: "g-cut", kind: "service", category: "Cuts", item: "Men's haircut", variant: null, price_type: "from", price: 18, duration_minutes: 30 })]);
    expect(items.map((i) => [i.item, i.options.map((o) => o.label)])).toEqual([["Men's haircut", [null]], ["Margherita pizza", ["10-inch", "12-inch"]]]);
    expect(items[1]).toMatchObject({ kind: "product", corrected: true, added: false, source_label: "menu.pdf" });
    expect(priceText(18, "from", "GBP")).toBe("from £18.00");
    expect(priceText(40, "per_hour", "GBP")).toBe("£40.00 per hour");
    expect(priceText(0, "free", "GBP")).toBe("Free");
    expect(priceText(null, "on_request", "GBP")).toBe("Price on request");
    expect(cleanTags(["vegetarian", "Spicy", "spicy", " house pick ", ""])).toEqual(["Vegetarian", "Spicy", "House pick"]);
  });

  it("says where each fact comes from", () => {
    expect(sourceLabel("https://www.sole.example/files/Menu%20Autumn.pdf")).toBe("Menu Autumn.pdf");
    expect(sourceLabel("https://sole.example/visit-us/")).toBe("sole.example/visit-us");
    expect(priceNote(row({}), NOW)).toBe("from menu.pdf, read today");
    expect(priceNote(row({ corrected: true }), NOW)).toBe("confirmed by the business");
    expect(facilityNote(facility({}), NOW)).toBe("from sole.example/visit, read 16 Nov");
    expect(facilityNote(facility({ confirmed: true }), NOW)).toBe("confirmed by the business");
  });

  it("the agent knows items with their options, tags and service details; only what this audience may see; never what's hidden", () => {
    const prices = [
      row({ tags: ["Vegetarian"] }), row({ variant: "10-inch", price: 7.5, tags: ["Vegetarian"] }),
      row({ group_id: "g-cut", kind: "service", category: "Cuts", item: "Men's haircut", variant: null, price_type: "from", price: 18, duration_minutes: 30, needs_booking: true, corrected: true }),
      row({ group_id: "g-staff", item: "Staff menu", variant: null, price: 5, visibility: "customers" }),
      row({ group_id: "g-old", item: "Old special", variant: null, hidden: true }),
    ];
    const facilities = [facility({}), facility({ key: "custom-ab12cd34", label: "Live music", evidence: "Fridays from 8pm", confirmed: true, source_label: null }), facility({ key: "wifi", hidden: true, confirmed: true })];
    const publicView = offeringsKnowledge(prices, facilities, "public", NOW);
    expect(publicView).toContain("- Pizza › Margherita pizza [Vegetarian]: 10-inch £7.50; 12-inch £8.50 (from menu.pdf, read today)");
    expect(publicView).toContain("Prices of services:\n- Cuts › Men's haircut: from £18.00, 30 min, booking needed (confirmed by the business)");
    expect(publicView).toContain("- Live music: yes, Fridays from 8pm (confirmed by the business)");
    expect(publicView).not.toContain("Wi-Fi");
    expect(publicView).not.toContain("Staff menu");
    expect(publicView).not.toContain("Old special");
    expect(offeringsKnowledge(prices, facilities, "customers", NOW)).toContain("Staff menu");
    expect(offeringsKnowledge([], [], "public", NOW)).toBe("");
  });

  it("comparisons: an answer's note is its source, and 'from' prices aren't ranked against fixed ones", () => {
    expect(splitSource("A margherita is £8.50 (from menu.pdf, read today)")).toEqual({ text: "A margherita is £8.50", source: "menu.pdf, read today" });
    const c: Pick<Comparison, "points" | "businesses" | "cells"> = {
      points: [{ label: "Haircut: price", kind: "price", question: "How much is a haircut?" }],
      businesses: [{ id: "a", handle: "a", name: "Cuts & Co" }, { id: "b", handle: "b", name: "Barber Bob" }],
      cells: [{ business_id: "a", point: 0, status: "answered", number: 15, basis: "from", currency: "GBP" }, { business_id: "b", point: 0, status: "answered", number: 20, basis: "fixed", currency: "GBP" }],
    };
    expect(summarise(c)).toEqual([`Only Barber Bob stated a price for haircut (£20). One price is given as "from" or per hour and isn't ranked.`]);
  });

  it("only pages that mention prices or facilities are read; the test stand-in reads simple menus and price lists", () => {
    expect(mentionsOfferings("About us: a family restaurant since 1987.")).toBe(false);
    expect(mentionsOfferings("Margherita £8.50")).toBe(true);
    expect(mockOfferings("Pizza\nMargherita pizza (10-inch) £7.50\nMargherita pizza (12-inch) £8.50\nMasala dosa (V)(HOT) £8.25\nServices\nRoom hire from £150 (120 min)\nFree car park behind the restaurant. Dogs welcome.")).toEqual({
      items: [
        { kind: "product", category: "Pizza", item: "Margherita pizza", description: null, tags: [], price_type: "fixed", duration_minutes: null, needs_booking: false, currency: "GBP", options: [{ label: "10-inch", price: 7.5 }, { label: "12-inch", price: 8.5 }] },
        { kind: "product", category: "Pizza", item: "Masala dosa", description: null, tags: ["Vegetarian", "Spicy"], price_type: "fixed", duration_minutes: null, needs_booking: false, currency: "GBP", options: [{ label: null, price: 8.25 }] },
        { kind: "service", category: "Services", item: "Room hire", description: null, tags: [], price_type: "from", duration_minutes: 120, needs_booking: false, currency: "GBP", options: [{ label: null, price: 150 }] },
      ],
      facilities: [{ key: "parking", status: "yes", evidence: "Free car park behind the restaurant" }, { key: "dog_friendly", status: "yes", evidence: "Dogs welcome" }],
    });
  });
});
