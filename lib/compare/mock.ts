/**
 * Test stand-ins for the comparison's two AI steps: a few clear phrasings → points, and answers → facts.
 * The real steps are AI calls (lib/compare/run.ts); these only have to be deterministic.
 */
import type { ComparePoint } from "./comparison";

export function mockComparePoints(text: string): { vague: boolean; points: ComparePoint[] } {
  const t = text.replace(/@[a-z0-9_]+/gi, " ").replace(/\s+/g, " ").toLowerCase();
  const points: ComparePoint[] = [];
  const price = t.match(/\b(?:cheapest|price of(?: a| the)?|how much is(?: a| the)?|cost of(?: a| the)?)\s+([a-z ]+?)(?=\s*(?:,|\?|\.| and\b|$))/);
  if (price) {
    const item = price[1].trim();
    points.push({ label: `${item[0].toUpperCase()}${item.slice(1)}: price`, kind: "price", question: `How much is a ${item}?` });
  }
  if (/\bparking\b/.test(t)) points.push({ label: "Parking", kind: "yes_no", question: "Do you have parking?" });
  const open = t.match(/\bopen on (\w+)/);
  if (open) points.push({ label: `Open on ${open[1]}`, kind: "text", question: `What time are you open on ${open[1]}?` });
  return { vague: !points.length, points };
}

export function mockCompareCells(items: { point: number; kind: string; text: string }[]) {
  return {
    cells: items.map(({ point, kind, text }) => {
      const stated = !/^i don't have|^i do not have|not sure/i.test(text.trim());
      const price = text.match(/([£€$])\s?(\d+(?:\.\d{1,2})?)/);
      const no = /\b(no parking|street parking only|we don't|we do not|there is no|there isn't)\b/i.test(text);
      const yes = !no && /\b(yes|free car park|car park|we have)\b/i.test(text);
      return {
        point,
        stated,
        text: text.replace(/\s+/g, " ").trim().slice(0, 120),
        number: kind === "price" && price ? Number(price[2]) : null,
        currency: kind === "price" && price ? ({ "£": "GBP", "€": "EUR", $: "USD" } as Record<string, string>)[price[1]] : null,
        yes: kind === "yes_no" && stated ? (no ? false : yes ? true : null) : null,
        detail: text.match(/\b(\d{1,2}-inch)\b/)?.[1] ?? null,
      };
    }),
  };
}
