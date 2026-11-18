import "server-only";
import { offersFromDuffel, type FlightOffer, type FlightQuery } from "./flights";

/**
 * Duffel (flights): live offers straight from airlines. Only the trip is sent (places, dates, how many
 * travellers, cabin). The token comes from DUFFEL_ACCESS_TOKEN; a test token gives test data.
 */
const base = () => process.env.DUFFEL_API_BASE || "https://api.duffel.com";
const token = () => process.env.DUFFEL_ACCESS_TOKEN?.trim() ?? "";
export const flightsConfigured = () => token().length > 0;
export const flightsTestMode = () => token().startsWith("duffel_test_");

async function call<T>(path: string, init: RequestInit = {}, timeoutMs = 25_000): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token()}`, "Duffel-Version": "v2", Accept: "application/json", "Content-Type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = (await res.json().catch(() => ({}))) as T & { errors?: { message?: string }[] };
  if (!res.ok) throw new Error(`Duffel ${res.status}: ${body.errors?.[0]?.message ?? "request failed"}`);
  return body;
}

export type Place = { code: string; name: string };
const places = new Map<string, Place | null>();

/** "London" → LON (all London airports); "Gatwick" → LGW. A city is preferred to one of its airports. */
export async function findPlace(text: string): Promise<Place | null> {
  const key = text.trim().toLowerCase();
  if (places.has(key)) return places.get(key)!;
  const { data } = await call<{ data?: { type?: string; iata_code?: string; name?: string }[] }>(`/places/suggestions?query=${encodeURIComponent(text.trim())}`, {}, 10_000);
  const list = (data ?? []).filter((p) => p.iata_code && p.name);
  const pick = list.find((p) => p.type === "city") ?? list[0];
  const place = pick ? { code: pick.iata_code!, name: pick.name! } : null;
  places.set(key, place);
  return place;
}

export type FlightSearch =
  | { status: "ok"; from: Place; to: Place; offers: FlightOffer[] }
  | { status: "unknown_place"; which: string }
  | { status: "unavailable" };

export async function searchFlights(q: FlightQuery): Promise<FlightSearch> {
  try {
    const [from, to] = await Promise.all([findPlace(q.from), findPlace(q.to)]);
    if (!from) return { status: "unknown_place", which: q.from };
    if (!to) return { status: "unknown_place", which: q.to };
    const slices = [{ origin: from.code, destination: to.code, departure_date: q.depart }, ...(q.return ? [{ origin: to.code, destination: from.code, departure_date: q.return }] : [])];
    const { data } = await call<{ data?: { offers?: Parameters<typeof offersFromDuffel>[0] } }>("/air/offer_requests?return_offers=true&supplier_timeout=15000", {
      method: "POST",
      body: JSON.stringify({ data: { slices, passengers: Array.from({ length: q.adults }, () => ({ type: "adult" })), cabin_class: q.cabin } }),
    });
    return { status: "ok", from, to, offers: offersFromDuffel(data?.offers ?? []) };
  } catch (error) {
    console.error("flights unavailable", error instanceof Error ? error.message : error);
    return { status: "unavailable" };
  }
}
