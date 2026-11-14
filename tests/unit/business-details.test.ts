import { expect, it } from "vitest";
import { businessDescription, publicBusinessDetails } from "@/lib/business/details";
import { businessKnowledge } from "@/lib/business/knowledge";
import { checkUrl } from "@/lib/business/extract";

it("keeps public marketing copy and practical information separate from customer-only information", () => {
  const info = { about: "Our full public introduction.", description: "Legacy short text", hours: "Monday 9–5", address: "1 Public Road", customers: "PRIVATE CUSTOMER DETAILS" };
  expect(businessDescription(info)).toBe(info.about);
  expect(publicBusinessDetails(info)).toEqual({ hours: info.hours, address: info.address });
  const result = businessKnowledge({ display_name: "Shop", handle: "shop", business_info: info }, [], "public");
  expect(result.info).toContain(info.about);
  expect(result.info).toContain(info.hours);
  expect(result.info).toContain(info.address);
  expect(result.info).not.toContain(info.customers);
});
it("uses only reviewed, visible website details until the owner supplies an override", () => {
  const site = { live_at: "2026-11-14", learned: { hours: "Site hours", address: "Site address" }, hidden: ["basic:address"] };
  expect(publicBusinessDetails({}, site)).toEqual({ hours: "Site hours", address: "" });
  expect(publicBusinessDetails({ hours: "Owner hours", address: "" }, site)).toEqual({ hours: "Owner hours", address: "" });
  expect(publicBusinessDetails({}, { ...site, live_at: null })).toEqual({ hours: "", address: "" });
  expect(publicBusinessDetails({ hours: "Owner hours", corrections: [{ label: "Opening hours", value: "Corrected hours" }] }, site)).toEqual({ hours: "Corrected hours", address: "" });
});
it("keeps nonstandard loopback ports behind the explicit development-only fetch option", () => {
  expect(checkUrl("http://127.0.0.1:3001/menu").ok).toBe(false);
  expect(checkUrl("http://127.0.0.1:3001/menu", { allowLocal: true }).ok).toBe(true);
  expect(checkUrl("https://example.com:3001/menu", { allowLocal: true }).ok).toBe(false);
});
