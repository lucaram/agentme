import "server-only";
import { offersFromLite, roomsFor, type HotelOffer, type HotelQuery } from "./hotels";

/**
 * LiteAPI (hotels, by Nuitée): live room rates. Only the stay is sent (city, country, dates, rooms,
 * currency). The key comes from LITEAPI_KEY; a sandbox key gives test data.
 */
const base = () => process.env.LITEAPI_API_BASE || "https://api.liteapi.travel";
const key = () => process.env.LITEAPI_KEY?.trim() ?? "";
export const hotelsConfigured = () => key().length > 0;

/** Rates are priced for travellers from this market; nothing about the owner is sent. */
const MARKET = "GB";

export type HotelSearch = { status: "ok"; offers: HotelOffer[]; sandbox: boolean } | { status: "unavailable" };

export async function searchHotels(q: HotelQuery): Promise<HotelSearch> {
  try {
    const res = await fetch(`${base()}/v3.0/hotels/rates`, {
      method: "POST",
      headers: { "X-API-Key": key(), accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        cityName: q.city, countryCode: q.country,
        checkin: q.checkin, checkout: q.checkout, occupancies: roomsFor(q.adults),
        currency: q.currency, guestNationality: MARKET,
        limit: 60, maxRatesPerHotel: 1, includeHotelData: true, timeout: 8,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json().catch(() => ({}))) as { data?: Parameters<typeof offersFromLite>[0]; hotels?: Parameters<typeof offersFromLite>[1]; sandbox?: boolean; error?: { code?: number; message?: string } };
    // A place it doesn't know comes back as no hotels (shown as such), not as an error.
    if (!res.ok) throw new Error(`LiteAPI ${res.status}: ${body.error?.message ?? "request failed"}`);
    return { status: "ok", offers: offersFromLite(body.data ?? [], body.hotels ?? []), sandbox: Boolean(body.sandbox) };
  } catch (error) {
    console.error("hotels unavailable", error instanceof Error ? error.message : error);
    return { status: "unavailable" };
  }
}
