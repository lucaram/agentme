import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nearestPlace, townLabel, validPosition, type Place } from "@/lib/geo/nearest";
import { placeNote } from "@/lib/research/place";

const SMALL: Place[] = [
  ["Edinburgh", "GB", 55.952, -3.196],
  ["Polmont", "GB", 55.991, -3.707],
  ["Falkirk", "GB", 56.002, -3.785],
  ["Suva", "FJ", -18.142, 178.442],
];

describe("📍 Near me now: a position becomes the nearest town, on our own server", () => {
  it("finds the nearest town", () => {
    expect(nearestPlace(SMALL, 56.0, -3.78)).toMatchObject({ name: "Falkirk", country: "GB" });
    expect(nearestPlace(SMALL, 55.98, -3.72)).toMatchObject({ name: "Polmont" });
    expect(nearestPlace(SMALL, 55.95, -3.2)).toMatchObject({ name: "Edinburgh", km: 0 });
  });

  it("no town within reach (open sea): none is named", () => {
    expect(nearestPlace(SMALL, 57.5, 2.5)).toBeNull();
    expect(nearestPlace([], 56, -3.78)).toBeNull();
  });

  it("works across the date line", () => {
    expect(nearestPlace(SMALL, -18.1, -179.9, 250)).toMatchObject({ name: "Suva" });
  });

  it("only real positions are used", () => {
    expect(validPosition(56, -3.78)).toBe(true);
    expect(validPosition(91, 0)).toBe(false);
    expect(validPosition(0, 181)).toBe(false);
    expect(validPosition("56", -3.78)).toBe(false);
    expect(validPosition(Number.NaN, 0)).toBe(false);
    expect(validPosition(undefined, undefined)).toBe(false);
  });

  it("the town is named with its country, and the answer says it's where you are now", () => {
    expect(townLabel({ name: "Falkirk", country: "GB" })).toBe("Falkirk, United Kingdom");
    expect(townLabel({ name: "Milan", country: "IT" })).toBe("Milan, Italy");
    expect(placeNote("Falkirk, United Kingdom", true)).toBe("📍 For Falkirk, United Kingdom, where you are now.");
  });

  it("the towns list shipped with the app knows real places", () => {
    const places = JSON.parse(readFileSync("lib/geo/places.json", "utf8")) as Place[];
    expect(places.length).toBeGreaterThan(50_000);
    expect(nearestPlace(places, 56.0, -3.78)).toMatchObject({ name: "Falkirk", country: "GB" });
    expect(nearestPlace(places, 45.46, 9.19)).toMatchObject({ name: "Milan", country: "IT" });
    expect(nearestPlace(places, 30, -40)).toBeNull(); // mid-Atlantic
  });
});
