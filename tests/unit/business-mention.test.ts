import { describe, expect, it } from "vitest";
import { looksLikeQuestion, matchBusinessName, nameCandidates } from "@/lib/agents/business-mention";

describe("asking a business through your agent", () => {
  it("recognises questions in several languages", () => {
    expect(looksLikeQuestion("Il sito di Everyeye non mi fa loggare, chi contatto?")).toBe(true);
    expect(looksLikeQuestion("Quando apre la trattoria")).toBe(true);
    expect(looksLikeQuestion("What time does Trattoria Sole close")).toBe(true);
    expect(looksLikeQuestion("I love Trattoria Sole")).toBe(false);
  });

  it("looks up only meaningful words (no accents, no common words)", () => {
    expect(nameCandidates("Il sito di Everyeye non mi fa loggare, chi contatto?")).toEqual(["everyeye", "loggare", "contatto"]);
    expect(nameCandidates("Caffè Aurora: dove siete?")).toEqual(["caffe", "aurora", "siete"]);
  });

  it("matches a business by its @handle as a word or its full name; the most specific wins", () => {
    const businesses = [
      { handle: "everyeye", display_name: "Everyeye Videogiochi" },
      { handle: "trattoria", display_name: "Trattoria Sole" },
      { handle: "sole_spa", display_name: "Sole" },
    ];
    expect(matchBusinessName("Il sito di Everyeye non mi fa loggare, chi contatto?", businesses)?.handle).toBe("everyeye");
    expect(matchBusinessName("Is Trattoria Sole open on Mondays?", businesses)?.handle).toBe("trattoria");
    expect(matchBusinessName("Does everyeyeshop sell games?", businesses)).toBeNull();
    expect(matchBusinessName("Who has the best pizza?", businesses)).toBeNull();
  });
});
