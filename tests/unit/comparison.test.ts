import { describe, expect, it } from "vitest";
import { splitSource, summarise, type CompareCell, type Comparison } from "@/lib/compare/comparison";
import { mockComparePoints } from "@/lib/compare/mock";

const businesses = [{ id: "a", handle: "sole", name: "Trattoria Sole" }, { id: "b", handle: "napoli", name: "Pizza Napoli" }, { id: "c", handle: "luigi", name: "Luigi's" }];
const points: Comparison["points"] = [
  { label: "Margherita pizza: price", kind: "price", question: "How much is a margherita pizza?" },
  { label: "Parking", kind: "yes_no", question: "Do you have parking?" },
];
const cell = (business_id: string, point: number, extra: Partial<CompareCell>): CompareCell => ({ business_id, point, status: "answered", ...extra });

describe("comparing businesses: the summary is worked out in code", () => {
  it("picks the cheapest stated price, never counts 'not stated', and says when sizes differ", () => {
    const lines = summarise({ businesses, points, cells: [
      cell("a", 0, { number: 8.5, currency: "GBP", detail: "12-inch" }), cell("b", 0, { number: 9, currency: "GBP", detail: "10-inch" }), cell("c", 0, { status: "not_stated" }),
      cell("a", 1, { yes: true }), cell("b", 1, { yes: false }), cell("c", 1, { status: "not_stated" }),
    ] });
    expect(lines).toEqual(["Cheapest stated margherita pizza: Trattoria Sole (£8.50). Sizes may differ.", "Parking: only Trattoria Sole says yes."]);
  });

  it("names ties, ignores other currencies, and is honest when only one or none stated", () => {
    expect(summarise({ businesses, points: [points[0]], cells: [cell("a", 0, { number: 9, currency: "GBP" }), cell("b", 0, { number: 9, currency: "GBP" }), cell("c", 0, { number: 5, currency: "EUR" })] }))
      .toEqual(["Cheapest stated margherita pizza: Trattoria Sole and Pizza Napoli (£9). Prices in another currency aren't compared."]);
    expect(summarise({ businesses, points: [points[0]], cells: [cell("a", 0, { number: 9, currency: "GBP" }), cell("b", 0, { status: "not_stated" })] })).toEqual(["Only Trattoria Sole stated a price for margherita pizza (£9)."]);
    expect(summarise({ businesses, points: [points[0]], cells: [cell("a", 0, { status: "not_stated" }), cell("b", 0, { status: "timeout" })] })).toEqual(["No business stated a price for margherita pizza."]);
    expect(summarise({ businesses, points: [points[1]], cells: [cell("a", 0, { status: "not_stated" }), cell("b", 0, { status: "not_stated" })] })).toEqual(["No business said anything about parking."]);
    expect(summarise({ businesses, points: [points[1]], cells: [cell("a", 0, { yes: true }), cell("b", 0, { status: "team_answered", yes: true })] })).toEqual(["Parking: Trattoria Sole and Pizza Napoli say yes."]);
  });

  it("separates where an answer came from", () => {
    expect(splitSource("A margherita is £8.50.\n\n📄 From sole.example/menu.pdf · checked today")).toEqual({ text: "A margherita is £8.50.", source: "menu.pdf" });
    expect(splitSource("Yes, free parking.\n\n📄 From sole.example/visit · checked 3 Nov")).toEqual({ text: "Yes, free parking.", source: "sole.example" });
    expect(splitSource("Yes.")).toEqual({ text: "Yes.", source: null });
  });

  it("the test stand-in turns the example request into a price point and a yes/no point", () => {
    expect(mockComparePoints("Which of @sole @napoli @luigi has the cheapest margherita pizza, and who has parking?")).toEqual({ vague: false, points });
    expect(mockComparePoints("Which of @sole @napoli is best?")).toEqual({ vague: true, points: [] });
  });
});
