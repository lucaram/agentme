import { describe, expect, it } from "vitest";
import { checkHotel, hotelLink, hotelsMessage, offersFromLite, pickHotels, roomsFor, NO_HOTEL, type HotelOffer, type HotelQuery } from "@/lib/travel/hotels";
import { mockRoute } from "@/lib/research/answer";

const TODAY = "2026-11-18";
const q = (p: Partial<HotelQuery>): HotelQuery => ({ ...NO_HOTEL, city: "Rome", country: "IT", checkin: "2026-12-12", checkout: "2026-12-14", adults: 2, ...p });
const offer = (p: Partial<HotelOffer>): HotelOffer => ({ name: "Hotel", stars: 4, rating: 8.5, reviews: 100, address: "Via Roma 1", total: 200, currency: "GBP", room: "Double", board: "Room Only", refundable: false, taxesAtHotel: 0, ...p });

describe("hotel prices", () => {
  it("checks the stay, or asks one thing", () => {
    expect(checkHotel(q({}), TODAY)).toEqual({ ok: true, query: q({}) });
    expect(checkHotel(q({ city: "" }), TODAY)).toMatchObject({ ok: false, ask: expect.stringContaining("Which city or town") });
    expect(checkHotel(q({ checkin: "" }), TODAY)).toEqual({ ok: false, ask: 'Which nights do you want to stay in Rome? For example: "12 to 14 December".' });
    expect(checkHotel(q({ checkout: "" }), TODAY)).toEqual({ ok: false, ask: "Until when do you want to stay in Rome? (Or how many nights?)" });
    expect(checkHotel(q({ country: "" }), TODAY)).toEqual({ ok: false, ask: "Which country is Rome in?" });
    expect(checkHotel(q({ checkin: "2026-11-10" }), TODAY)).toMatchObject({ ok: false, ask: expect.stringContaining("already passed") });
    expect(checkHotel(q({ checkout: "2026-12-12" }), TODAY)).toMatchObject({ ok: false, ask: expect.stringContaining("after the check-in day") });
    expect(checkHotel(q({ checkout: "2027-01-20" }), TODAY)).toMatchObject({ ok: false, ask: expect.stringContaining("30 nights") });
    expect(checkHotel(q({ adults: 20, country: "it", currency: "eur", max_per_night: 149.6 }), TODAY)).toMatchObject({ ok: true, query: { adults: 8, country: "IT", currency: "EUR", max_per_night: 150 } });
    expect(roomsFor(5)).toEqual([{ adults: 2 }, { adults: 2 }, { adults: 1 }]);
  });

  it("reads each hotel's cheapest offer with its details", () => {
    const offers = offersFromLite(
      [
        { hotelId: "a", roomTypes: [
          { offerRetailRate: { amount: 300, currency: "GBP" }, rates: [{ name: "Suite", boardName: "Breakfast Included", cancellationPolicies: { refundableTag: "RFN" } }] },
          { offerRetailRate: { amount: 282.45, currency: "GBP" }, rates: [{ name: "Double", boardName: "Room Only", retailRate: { taxesAndFees: [{ included: false, amount: 33.31 }, { included: true, amount: 10 }] }, cancellationPolicies: { refundableTag: "NRFN" } }] },
        ] },
        { hotelId: "unknown", roomTypes: [{ offerRetailRate: { amount: 50 }, rates: [{ name: "Room" }] }] },
      ],
      [{ id: "a", name: "Hotel Artemide", stars: 4, rating: 8.9, review_count: 2171, address: "Via Nazionale 22" }],
    );
    expect(offers).toEqual([{ name: "Hotel Artemide", stars: 4, rating: 8.9, reviews: 2171, address: "Via Nazionale 22", total: 282.45, currency: "GBP", room: "Double", board: "Room Only", refundable: false, taxesAtHotel: 33.31 }]);
  });

  it("picks within the budget, well-reviewed first by price, or the best rated; writes the answer", () => {
    const offers = [offer({ name: "Cheap & poor", total: 120, rating: 6.1 }), offer({ name: "Good", total: 240, rating: 8.2 }), offer({ name: "Great", total: 280, rating: 9.4 }), offer({ name: "Fine", total: 260, rating: 7.9 }), offer({ name: "Pricey", total: 900, rating: 9.8 })];
    expect(pickHotels(offers, q({})).shown.map((o) => o.name)).toEqual(["Good", "Fine", "Great"]);
    expect(pickHotels(offers, q({ max_per_night: 135 })).shown.map((o) => o.name)).toEqual(["Cheap & poor", "Good", "Fine"]);
    expect(pickHotels(offers, q({ sort: "rating" })).shown.map((o) => o.name)).toEqual(["Pricey", "Great", "Good"]);
    const text = hotelsMessage(q({ max_per_night: 150 }), [offer({ name: "Hotel Artemide", total: 282.45, rating: 8.9, reviews: 2171, address: "Via Nazionale 22", taxesAtHotel: 33.31 })], { test: true });
    expect(text).toBe([
      "🏨 Rome · Sat 12 Dec – Mon 14 Dec (2 nights) · 2 adults · up to £150 a night",
      "1. **Hotel Artemide** ★★★★ · 8.9/10 (2,171 reviews)\n   £282 for 2 nights (£141 a night) · room only · non-refundable\n   Via Nazionale 22 · + £33.31 taxes paid at the hotel",
      "Best value of 1 hotel with rooms in your budget, checked just now. Prices change quickly, and nothing is booked.",
      "🧪 Test data (hotel provider's sandbox): not real prices.",
    ].join("\n\n"));
    expect(hotelsMessage(q({ max_per_night: 50 }), offers, { test: false })).toContain("None of the 5 hotels with rooms is within £50 a night. The cheapest is £60 a night.");
    expect(hotelsMessage(q({}), [], { test: false })).toContain("I couldn't find hotels with rooms for those nights.");
    expect(hotelLink("Hotel Artemide", "Rome")).toBe("https://www.google.com/search?q=Hotel%20Artemide%20Rome");
  });

  it("the stand-in router finds hotel requests and their stay", () => {
    expect(mockRoute("best hotels in Rome from 2026-12-12 to 2026-12-14 for 2 under £150")).toMatchObject({ kind: "hotels", hotel: { city: "Rome", country: "IT", checkin: "2026-12-12", checkout: "2026-12-14", adults: 2, max_per_night: 150, sort: "rating" } });
    expect(mockRoute("cheapest flights from London to Rome on 2026-12-12").hotel).toEqual(NO_HOTEL);
  });
});
