import { describe, expect, it } from "vitest";
import { checkFlight, compareLink, flightsMessage, offersFromDuffel, NO_FLIGHT, type FlightQuery } from "@/lib/travel/flights";
import { mockRoute } from "@/lib/research/answer";

const TODAY = "2026-11-18";
const q = (p: Partial<FlightQuery>): FlightQuery => ({ ...NO_FLIGHT, from: "London", to: "Rome", depart: "2026-12-12", ...p });
const seg = (from: string, to: string, dep: string, arr: string) => ({ origin: { iata_code: from }, destination: { iata_code: to }, departing_at: dep, arriving_at: arr });

describe("flight prices", () => {
  it("checks the trip, or asks one thing", () => {
    expect(checkFlight(q({}), TODAY)).toEqual({ ok: true, query: q({}) });
    expect(checkFlight(q({ from: "", to: "" }), TODAY)).toMatchObject({ ok: false, ask: expect.stringContaining("Where are you flying from and to?") });
    expect(checkFlight(q({ from: "" }), TODAY)).toEqual({ ok: false, ask: "Where are you flying to Rome from?" });
    expect(checkFlight(q({ to: "" }), TODAY)).toEqual({ ok: false, ask: "Where do you want to fly to from London?" });
    expect(checkFlight(q({ depart: "" }), TODAY)).toEqual({ ok: false, ask: "Which day do you want to fly from London to Rome?" });
    expect(checkFlight(q({ depart: "2026-11-17" }), TODAY)).toMatchObject({ ok: false, ask: "That day has already passed. Which day do you want to fly?" });
    expect(checkFlight(q({ depart: "2027-12-01" }), TODAY)).toMatchObject({ ok: false, ask: expect.stringContaining("11 months ahead") });
    expect(checkFlight(q({ return: "2026-12-10" }), TODAY)).toMatchObject({ ok: false, ask: expect.stringContaining("before the outbound day") });
    // Travellers are kept to 1–9; a return day that isn't a date is dropped.
    expect(checkFlight(q({ adults: 14, return: "next week" }), TODAY)).toMatchObject({ ok: true, query: { adults: 9, return: "" } });
  });

  it("reads the offers cheapest first, each flight once, and writes the answer (a return trip, two people)", () => {
    const offers = offersFromDuffel([
      { total_amount: "240.00", total_currency: "GBP", owner: { name: "ITA" }, slices: [{ duration: "PT2H30M", segments: [seg("LHR", "FCO", "2026-12-12T09:00:00", "2026-12-12T12:30:00")] }, { duration: "PT2H50M", segments: [seg("FCO", "LHR", "2026-12-15T18:00:00", "2026-12-15T19:50:00")] }] },
      { total_amount: "180.50", total_currency: "GBP", owner: { name: "easyJet" }, slices: [{ duration: "PT2H35M", segments: [seg("LGW", "FCO", "2026-12-12T06:45:00", "2026-12-12T10:20:00")] }, { duration: "PT14H5M", segments: [seg("FCO", "MXP", "2026-12-15T21:00:00", "2026-12-15T22:10:00"), seg("MXP", "LGW", "2026-12-16T09:00:00", "2026-12-16T10:05:00")] }] },
      { total_amount: "180.50", total_currency: "GBP", owner: { name: "easyJet" }, slices: [{ duration: "PT2H35M", segments: [seg("LGW", "FCO", "2026-12-12T06:45:00", "2026-12-12T10:20:00")] }, { duration: "PT14H5M", segments: [seg("FCO", "MXP", "2026-12-15T21:00:00", "2026-12-15T22:10:00"), seg("MXP", "LGW", "2026-12-16T09:00:00", "2026-12-16T10:05:00")] }] },
      { total_amount: "not a price", owner: { name: "Broken" }, slices: [] },
    ]);
    expect(offers.map((o) => [o.airline, o.price])).toEqual([["easyJet", 180.5], ["ITA", 240]]);
    const trip = q({ return: "2026-12-15", adults: 2 });
    const text = flightsMessage(trip, { from: "London", to: "Rome" }, offers, { test: false });
    expect(text).toBe([
      "✈️ London → Rome · Sat 12 Dec – Tue 15 Dec (return) · 2 adults",
      "1. **easyJet** · £180.50 for 2 adults return\n   06:45 LGW → 10:20 FCO · direct · 2h 35m\n   Back: 21:00 FCO → 10:05 (+1) LGW · 1 stop · 14h 5m\n2. **ITA** · £240.00 for 2 adults return\n   09:00 LHR → 12:30 FCO · direct · 2h 30m\n   Back: 18:00 FCO → 19:50 LHR · direct · 2h 50m",
      "Cheapest of 2 options, checked just now. Prices change quickly, and nothing is booked: book with the airline or compare below.",
    ].join("\n\n"));
    expect(flightsMessage(q({}), { from: "London", to: "Rome" }, [], { test: true })).toContain("I couldn't find any flights for that trip.");
    expect(flightsMessage(q({}), { from: "London", to: "Rome" }, offers, { test: true })).toContain("🧪 Test data");
    expect(compareLink("LON", "ROM", trip)).toBe("https://www.google.com/travel/flights?q=Flights%20from%20LON%20to%20ROM%20on%202026-12-12%20returning%202026-12-15");
  });

  it("the stand-in router finds flight requests and their trip", () => {
    expect(mockRoute("cheapest flights from London to Rome on 2026-12-12 for 2")).toMatchObject({ kind: "flights", flight: { from: "London", to: "Rome", depart: "2026-12-12", adults: 2 } });
    expect(mockRoute("what's the weather in Leith?")).toMatchObject({ kind: "research", flight: NO_FLIGHT });
  });
});
