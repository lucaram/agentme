import "server-only";
import { searchFlights, flightsTestMode } from "./duffel";
import { checkFlight, compareLink, flightsMessage, type FlightQuery } from "./flights";

export type FlightReply = { content: string; metadata: Record<string, unknown> };

/** "new york" → "New York"; codes like "LGW" stay as they are. */
const placeName = (text: string) => text.replace(/\b\p{Ll}/gu, (c) => c.toUpperCase());

/**
 * A flight request in My Agent: checked (or one question back), searched with the flight provider, and
 * answered by code with the cheapest options. `request` is the owner's own words, kept only in their own
 * chat so a reply like "on Friday" can complete it; only the trip itself goes to the provider.
 */
export async function answerFlightRequest(flight: FlightQuery, request: string, today = new Date().toISOString().slice(0, 10)): Promise<FlightReply> {
  const ask = (content: string): FlightReply => ({ content, metadata: { kind: "flights_ask", request: request.trim().slice(0, 500) } });
  const checked = checkFlight(flight, today);
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
