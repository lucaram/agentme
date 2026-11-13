import { describe, expect, it } from "vitest";
import { dependsOnPlace, placeNote, townOf, withPlace } from "@/lib/research/place";

describe("look-ups use the town where you usually are", () => {
  it("only the town leaves: never a street, a house number or a postcode", () => {
    expect(townOf("12 High Street, Falkirk FK1 1AA")).toBe("Falkirk");
    expect(townOf("Flat 3, 12 Shore Road, Leith, Edinburgh EH6 6QW")).toBe("Leith, Edinburgh");
    expect(townOf("Via Roma 12, Milano")).toBe("Milano");
    expect(townOf("FK1 1AA")).toBeNull();
    expect(townOf("12 High Street")).toBeNull();
  });

  it("reads how people write it", () => {
    expect(townOf("Lives in Islington")).toBe("Islington");
    expect(townOf("Camden, London")).toBe("Camden, London");
    expect(townOf("I'm usually near Leith")).toBe("Leith");
    expect(townOf("Reddingmuirhead, Scotland")).toBe("Reddingmuirhead, Scotland");
    expect(townOf("   ")).toBeNull();
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
