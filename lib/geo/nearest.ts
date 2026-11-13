/**
 * "📍 Near me now": a position becomes the nearest town, on our own server,
 * from a list of towns shipped with the app (GeoNames, CC BY 4.0). Pure.
 * The position itself is never stored and never leaves: only the town's name
 * goes with a look-up.
 */

/** [name, country code, latitude, longitude] */
export type Place = readonly [string, string, number, number];

/** How far the nearest town may be: beyond this (open sea, wilderness) there's no town to name. */
export const MAX_TOWN_KM = 60;

const KM_PER_DEGREE = 111.32;

/** A position worth using: real numbers inside the globe. */
export function validPosition(lat: unknown, lon: unknown): lat is number {
  return typeof lat === "number" && typeof lon === "number" && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

/** The nearest town to a position, or null when none is within `maxKm`. */
export function nearestPlace(places: readonly Place[], lat: number, lon: number, maxKm = MAX_TOWN_KM): { name: string; country: string; km: number } | null {
  const shrink = Math.cos((lat * Math.PI) / 180);
  let best: Place | null = null;
  let bestKm = Infinity;
  for (const p of places) {
    const dLat = p[2] - lat;
    // Cheap skip: more than the limit away north-south alone.
    if (Math.abs(dLat) * KM_PER_DEGREE > maxKm) continue;
    let dLon = Math.abs(p[3] - lon);
    if (dLon > 180) dLon = 360 - dLon;
    const km = Math.hypot(dLat, dLon * shrink) * KM_PER_DEGREE;
    if (km < bestKm) [best, bestKm] = [p, km];
  }
  return best && bestKm <= maxKm ? { name: best[0], country: best[1], km: Math.round(bestKm) } : null;
}

/** "Falkirk, United Kingdom": enough for a search to know which Falkirk. */
export function townLabel(place: { name: string; country: string }): string {
  let country = place.country;
  try {
    country = new Intl.DisplayNames(["en"], { type: "region" }).of(place.country) ?? place.country;
  } catch {
    // keep the code
  }
  return `${place.name}, ${country}`;
}
