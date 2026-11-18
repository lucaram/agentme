import { describe, expect, it } from "vitest";
import { checkEnergy, currentCost, energyMessage, outwardCode, usageOf, yearlyCost, NO_ENERGY, type Deal, type EnergyQuery } from "@/lib/energy/check";
import { mockRoute } from "@/lib/research/answer";

const q = (p: Partial<EnergyQuery>): EnergyQuery => ({ ...NO_ENERGY, postcode: "NW1", ...p });
const FLEX: Deal = { name: "Flexible Octopus", fixedMonths: null, exitFee: 0, elec: { unit: 26.6, standing: 41.39 }, gas: { unit: 8.15, standing: 29.24 } };
const FIX12: Deal = { name: "Octopus 12M Fixed", fixedMonths: 12, exitFee: 50, elec: { unit: 28.98, standing: 41.39 }, gas: { unit: 9.75, standing: 29.24 } };

describe("energy check", () => {
  it("only the first half of the postcode is used, and it's asked for when missing", () => {
    expect(outwardCode("nw1 4rg")).toBe("NW1");
    expect(outwardCode("M11AE")).toBe("M1");
    expect(outwardCode("SW1A")).toBe("SW1A");
    expect(outwardCode("London")).toBeNull();
    expect(checkEnergy(q({ postcode: "" }))).toEqual({ ok: false, ask: "Which postcode area are you in? Just the first part, like NW1: prices depend on the region." });
    expect(checkEnergy(q({ postcode: "ls6 2ab", elec_rate: 900, yearly_cost: -5 }))).toMatchObject({ ok: true, outward: "LS6", query: { postcode: "LS6", elec_rate: 0, yearly_cost: 0 } });
  });

  it("works out yearly costs for the fuels needed, from rates or the amount paid", () => {
    expect(usageOf(q({}))).toEqual({ elec: 2700, gas: 11500, typical: true });
    expect(usageOf(q({ fuel: "gas", gas_kwh: 12000 }))).toEqual({ elec: 2700, gas: 12000, typical: false });
    expect(yearlyCost(q({ fuel: "electricity" }), FLEX)).toBeCloseTo((2700 * 26.6 + 365 * 41.39) / 100);
    expect(yearlyCost(q({}), { ...FLEX, gas: null })).toBeNull(); // a deal without gas can't cover both
    expect(currentCost(q({ fuel: "electricity", elec_rate: 27.5, elec_standing: 45 }))).toBeCloseTo((2700 * 27.5 + 365 * 45) / 100);
    expect(currentCost(q({ fuel: "both", elec_rate: 27.5, elec_standing: 45 }))).toBeNull(); // gas rates missing
    expect(currentCost(q({ yearly_cost: 1800 }))).toBe(1800);
  });

  it("writes the check: savings from rates; a bill amount against a typical home isn't claimed as a saving", () => {
    const fromRates = energyMessage(q({ fuel: "electricity", elec_rate: 27.5, elec_standing: 45 }), "London", [FIX12, FLEX]);
    expect(fromRates.split("\n\n").slice(0, 3)).toEqual([
      "⚡ Energy check · London (NW1) · electricity 2,700 kWh a year (a typical home)",
      "You pay about £907 a year now: you could save about £37 a year with Flexible Octopus.",
      "1. **Flexible Octopus** · £869 a year · £37 less than now\n   variable (follows the price cap) · no exit fees\n   Electricity 26.6p/kWh + 41.39p/day\n2. **Octopus 12M Fixed** · £934 a year · £27 more than now\n   fixed for 12 months · £50 exit fee per fuel\n   Electricity 28.98p/kWh + 41.39p/day",
    ]);
    expect(fromRates).toContain("These are Octopus Energy's deals: to compare every supplier, use an Ofgem-accredited comparison site. Nothing is switched for you.");
    const fromBill = energyMessage(q({ yearly_cost: 1800 }), "North West England", [FLEX]);
    expect(fromBill).toContain("You pay about £1,800 a year. A typical home would pay about £1,913 with Flexible Octopus, but your use may be different");
    expect(fromBill).not.toContain("than now");
    expect(energyMessage(q({ yearly_cost: 1800, elec_kwh: 2000, gas_kwh: 8000 }), "London", [FLEX])).toContain("£1,800 a year now: you could save");
    expect(energyMessage(q({ fuel: "gas", gas_kwh: 12000 }), "Yorkshire", [FLEX])).toContain("Tell me your unit rates and standing charges");
    expect(energyMessage(q({}), "London", [])).toContain("I couldn't find deals for your area just now.");
  });

  it("the stand-in router finds energy questions", () => {
    expect(mockRoute("am I paying too much for electricity? NW1, 27.5p and 45p a day")).toMatchObject({ kind: "energy", energy: { fuel: "electricity", postcode: "NW1", elec_rate: 27.5, elec_standing: 45 } });
    expect(mockRoute("what's the weather in Leith?").energy).toEqual(NO_ENERGY);
  });
});
