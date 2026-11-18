import { describe, expect, it } from "vitest";
import { applyUpdate, checkUpdate, looksAboutSelf, sectionName, type ProfileUpdate } from "@/lib/profile/update";
import { mockProfileUpdates } from "@/lib/profile/mock-updates";

const u = (p: Partial<ProfileUpdate>): ProfileUpdate => ({ category: "availability", topic: null, action: "add", value: "", old: null, reason: "", until: null, ...p });

describe("profile updates from what you say in My Agent", () => {
  it("looks only at things you say about yourself", () => {
    for (const text of ["I'm free on Tuesday evenings", "I eat fish now", "My budget is about £30", "I live in Edinburgh"]) expect(looksAboutSelf(text), text).toBe(true);
    for (const text of ["When am I free?", "Organise dinner with @marco", "Marco is vegetarian", "What's the weather in Rome", "Can you help me?", "ok"]) expect(looksAboutSelf(text), text).toBe(false);
  });

  it("offers only real changes: nothing already saved, and changes must name saved text", () => {
    const saved = "Saturdays after 7 PM; Sundays all day";
    expect(checkUpdate(u({ value: "Sundays all day" }), saved)).toBeNull();
    expect(checkUpdate(u({ value: "Tuesday evenings." }), saved)).toMatchObject({ action: "add", value: "Tuesday evenings" });
    expect(checkUpdate(u({ action: "remove", old: "Saturdays after 7 PM" }), saved)).toMatchObject({ action: "remove", old: "Saturdays after 7 PM" });
    expect(checkUpdate(u({ action: "remove", old: "Mondays" }), saved)).toBeNull();
    // A "change" to text that isn't saved is offered as an addition.
    expect(checkUpdate(u({ action: "replace", old: "Fridays", value: "Thursdays" }), saved)).toMatchObject({ action: "add", value: "Thursdays", old: null });
  });

  it("applies exactly what the card showed", () => {
    expect(applyUpdate("Saturdays after 7 PM; Sundays all day", u({ value: "Tuesday evenings" }))).toBe("Saturdays after 7 PM; Sundays all day; Tuesday evenings");
    expect(applyUpdate(undefined, u({ value: "Tuesday evenings" }))).toBe("Tuesday evenings");
    expect(applyUpdate("Saturdays after 7 PM; Sundays all day", u({ action: "remove", old: "Saturdays after 7 PM" }))).toBe("Sundays all day");
    expect(applyUpdate("Italian, vegetarian", u({ category: "food", action: "replace", old: "vegetarian", value: "pescatarian" }))).toBe("Italian, pescatarian");
    expect(applyUpdate("vegetarian", u({ category: "food", action: "replace", old: "vegetarian", value: "pescatarian" }), true)).toBe("vegetarian; pescatarian");
  });

  it("names the section as Settings shows it", () => {
    expect(sectionName("availability")).toBe("When you're free");
    expect(sectionName("food")).toBe("Lifestyle → Food & drink");
    expect(sectionName("away")).toBe("Away for a while");
    expect(sectionName("notes")).toBe("Private notes");
    expect(sectionName("custom", "My car")).toBe("My car");
  });

  it("the test stand-in: adds, removes the saved part, and spots the vegetarian contradiction", () => {
    expect(mockProfileUpdates("I'm also free on Tuesday and Thursday evenings too", {})).toMatchObject([{ category: "availability", action: "add", value: "Tuesday and Thursday evenings" }]);
    expect(mockProfileUpdates("I can't do Saturdays any more", { availability: "Saturdays after 7 PM; Sundays all day" })).toMatchObject([{ action: "remove", old: "Saturdays after 7 PM" }]);
    expect(mockProfileUpdates("I eat fish now", { food: "vegetarian" })).toMatchObject([{ action: "replace", old: "vegetarian", value: "pescatarian" }]);
    expect(mockProfileUpdates("I've just bought a blue Golf", {}, { "My car": "Red Fiat 500" })).toMatchObject([{ category: "custom", topic: "My car", action: "replace", old: "Red Fiat 500", value: "blue Golf" }]);
  });
});
