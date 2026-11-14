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

let names: Set<string> | null = null;
/** Is this exactly the name of a town in the list? (For using only a real town from what someone wrote as their usual place.) */
export function isKnownPlace(name: string): boolean {
  if (!names) names = new Set(load().map((p) => placeKey(p[0])));
  const key = placeKey(name);
  return key.length >= 2 && names.has(key);
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
