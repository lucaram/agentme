import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { nearestPlace, townLabel, validPosition, type Place } from "./nearest";
import { placeKey } from "@/lib/research/place";

/** Towns of 5,000+ people worldwide (GeoNames, CC BY 4.0; built by scripts/build-places.mjs). Loaded once, on first use. */
let places: Place[] | null = null;
function load(): Place[] {
  if (!places) {
    try {
      places = JSON.parse(readFileSync(path.join(process.cwd(), "lib", "geo", "places.json"), "utf8")) as Place[];
    } catch (error) {
      console.error("places list unavailable", error instanceof Error ? error.message : error);
      places = [];
    }
  }
  return places;
}

let names: Map<string, string[]> | null = null;
/**
 * The list's own name for a town, when this is exactly one (accents, case and punctuation aside); otherwise
 * null. What comes back is the list's text, never the caller's: for using only a real town from what
 * someone wrote as their usual place. Several towns can share their letters ("Milan", "Milán"): the one
 * spelled as written wins, otherwise the first.
 */
export function knownTown(name: string): string | null {
  if (!names) {
    names = new Map();
    for (const p of load()) {
      const key = placeKey(p[0]);
      if (key.length < 2) continue;
      const same = names.get(key);
      if (!same) names.set(key, [p[0]]);
      else if (!same.includes(p[0])) same.push(p[0]);
    }
  }
  const spellings = names.get(placeKey(name));
  if (!spellings) return null;
  const written = name.trim().toLowerCase();
  return spellings.find((s) => s.toLowerCase() === written) ?? spellings[0];
}

/**
 * The town a position is in or nearest to ("Falkirk, United Kingdom"), or null.
 * Worked out here, on our own server: the position is not stored, logged or
 * sent anywhere.
 */
export function townAt(position: { lat?: unknown; lon?: unknown } | null | undefined): string | null {
  if (!position || !validPosition(position.lat, position.lon)) return null;
  const found = nearestPlace(load(), position.lat, position.lon as number);
  return found ? townLabel(found) : null;
}
