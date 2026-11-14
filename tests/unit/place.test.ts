import { describe, expect, it } from "vitest";
import { dependsOnPlace, placeKey, placeNote, townOf, withPlace } from "@/lib/research/place";
import { isKnownPlace } from "@/lib/geo";

/** A stand-in for the list of towns shipped with the app. */
const TOWNS = new Set(["falkirk", "islington", "london", "edinburgh", "milano", "charlotte", "sant angelo"]);
const known = (name: string) => TOWNS.has(placeKey(name));

describe("look-ups use the town where you usually are", () => {
  it("only the town leaves: never a street, a house number or a postcode", () => {
    expect(townOf("12 High Street, Falkirk FK1 1AA", known)).toBe("Falkirk");
    expect(townOf("Flat 3, 12 Shore Road, Edinburgh EH6 6QW", known)).toBe("Edinburgh");
    expect(townOf("Via Roma 12, Milano", known)).toBe("Milano");
    expect(townOf("FK1 1AA", known)).toBeNull();
    expect(townOf("12 High Street", known)).toBeNull();
  });

  it("nothing else the person wrote there goes out with a search", () => {
    // "Where you usually are" is free text: only a part that is a town we know is used, and only its name.
    expect(townOf("Falkirk, staying with Sarah", known)).toBe("Falkirk");
    expect(townOf("Falkirk, staying with Charlotte until March", known)).toBe("Falkirk");
    expect(townOf("staying with Sarah, Falkirk", known)).toBe("Falkirk");
    expect(townOf("Falkirk - my mum's house while I recover", known)).toBe("Falkirk");
    // No part is a town: nothing is used, and the agent asks which place instead.
    expect(townOf("at my sister's most weeks", known)).toBeNull();
    expect(townOf("staying with Sarah in Falkirk", known)).toBeNull();
    expect(townOf("Falkirkshire somewhere", known)).toBeNull();
  });

  it("reads how people write a town", () => {
    expect(townOf("Lives in Islington", known)).toBe("Islington");
    expect(townOf("Islington, London", known)).toBe("Islington"); // one name only
    expect(townOf("I'm usually near Edinburgh", known)).toBe("Edinburgh");
    expect(townOf("SANT’ANGELO", known)).toBe("SANT’ANGELO");
    expect(townOf("   ", known)).toBeNull();
  });

  it("the real list knows real towns, and not arbitrary words", () => {
    for (const town of ["Falkirk", "Islington", "Edinburgh", "Milan", "Polmont"]) expect(isKnownPlace(town), town).toBe(true);
    for (const text of ["staying with Sarah", "my mum's house", "x", ""]) expect(isKnownPlace(text), text).toBe(false);
    expect(townOf("Falkirk, staying with Sarah", isKnownPlace)).toBe("Falkirk");
    expect(withPlace("What is the weather?", townOf("Falkirk, staying with Sarah", isKnownPlace)!)).toBe("What is the weather in Falkirk?");
  });

  it("only for questions that depend on where you are", () => {
    for (const t of ["What's the weather?", "Will it rain tomorrow?", "a good plumber near me", "any pizza places nearby?", "che tempo fa? meteo", "local news"]) expect(dependsOnPlace(t)).toBe(true);
    for (const t of ["What's the latest Zelda review score?", "Who won the match?", "price of a PS5"]) expect(dependsOnPlace(t)).toBe(false);
  });

  it("the search gets the question with the town; the answer says which place was assumed", () => {
    expect(withPlace("What's the weather?", "Islington")).toBe("What's the weather in Islington?");
    expect(withPlace("a good plumber near me", "Falkirk")).toBe("a good plumber near Falkirk");
    expect(withPlace("weather in Islington today", "Islington")).toBe("weather in Islington today");
    expect(placeNote("Islington")).toBe("📍 For Islington, where you usually are.");
  });
});
