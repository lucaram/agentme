import "server-only";
import { searchFlights, flightsTestMode } from "./duffel";
import { checkFlight, compareLink, flightsMessage, type FlightQuery } from "./flights";
import { searchHotels } from "./liteapi";
import { checkHotel, hotelLink, hotelsMessage, pickHotels, type HotelQuery } from "./hotels";

export type TravelReply = { content: string; metadata: Record<string, unknown> };

/** "new york" → "New York"; codes like "LGW" stay as they are. */
const placeName = (text: string) => text.replace(/\b\p{Ll}/gu, (c) => c.toUpperCase());
const today = () => new Date().toISOString().slice(0, 10);

/**
 * A flight request in My Agent: checked (or one question back), searched with the flight provider, and
 * answered by code with the cheapest options. `request` is the owner's own words, kept only in their own
 * chat so a reply like "on Friday" can complete it; only the trip itself goes to the provider.
 */
export async function answerFlightRequest(flight: FlightQuery, request: string, on = today()): Promise<TravelReply> {
  const ask = (content: string): TravelReply => ({ content, metadata: { kind: "flights_ask", request: request.trim().slice(0, 500) } });
  const checked = checkFlight(flight, on);
  if (!checked.ok) return ask(checked.ask);
  const found = await searchFlights(checked.query);
  if (found.status === "unknown_place") return ask(`I couldn't find an airport for "${found.which}". Which city or airport do you mean?`);
  if (found.status === "unavailable") return { content: "I couldn't check flights just now. Please try again in a moment.", metadata: { kind: "flights_answer", flights: "unavailable" } };
  return {
    // The places as the owner named them ("Manchester", not "Manchester Airport"); each flight shows its airports.
    content: flightsMessage(checked.query, { from: placeName(checked.query.from), to: placeName(checked.query.to) }, found.offers, { test: flightsTestMode() }),
    metadata: {
      kind: "flights_answer",
      flights: found.offers.length ? "found" : "none",
      sources: found.offers.length ? [{ url: compareLink(found.from.code, found.to.code, checked.query), title: "Compare and book (Google Flights)" }] : [],
    },
  };
}

/** The same for a hotel request: the stay checked, rates searched, the best options written by code. */
export async function answerHotelRequest(hotel: HotelQuery, request: string, on = today()): Promise<TravelReply> {
  const checked = checkHotel(hotel, on);
  if (!checked.ok) return { content: checked.ask, metadata: { kind: "hotels_ask", request: request.trim().slice(0, 500) } };
  const query = { ...checked.query, city: placeName(checked.query.city) };
  const found = await searchHotels(query);
  if (found.status === "unavailable") return { content: "I couldn't check hotels just now. Please try again in a moment.", metadata: { kind: "hotels_answer", hotels: "unavailable" } };
  const { shown } = pickHotels(found.offers, query);
  return {
    content: hotelsMessage(query, found.offers, { test: found.sandbox }),
    metadata: { kind: "hotels_answer", hotels: shown.length ? "found" : "none", sources: shown.map((o) => ({ url: hotelLink(o.name, query.city), title: o.name })) },
  };
}
