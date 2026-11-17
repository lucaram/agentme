import { describe, expect, it } from "vitest";
import { accentShades, pageSettings, pageSettingsFrom } from "@/lib/business/public-page";

describe("a business's public page: what it shows and its colour", () => {
  it("by default it shows everything, in each visitor's own colours", () => {
    expect(pageSettings({})).toEqual({ accent: null, show: { description: true, hours: true, address: true, actions: true } });
    expect(pageSettings(null)).toEqual(pageSettings({}));
    expect(pageSettings({ page: "nonsense" })).toEqual(pageSettings({}));
  });

  it("reads what the business chose; anything unknown is ignored", () => {
    expect(pageSettings({ page: { accent: "teal", show: { address: false } } })).toEqual({ accent: "teal", show: { description: true, hours: true, address: false, actions: true } });
    // No free colours: only the hand-tuned accents.
    expect(pageSettings({ page: { accent: "#ff0000" } }).accent).toBeNull();
    expect(pageSettings({ page: { show: { secret: false } } }).show).toEqual({ description: true, hours: true, address: true, actions: true });
  });

  it("from the form: ticked parts are shown, the rest hidden; only known colours", () => {
    expect(pageSettingsFrom({ accent: "pink", show: ["hours", "actions", "anything"] })).toEqual({ accent: "pink", show: { description: false, hours: true, address: false, actions: true } });
    expect(pageSettingsFrom({ accent: "", show: [] }).accent).toBeNull();
    expect(pageSettingsFrom({ accent: "javascript:alert(1)" }).accent).toBeNull();
  });

  it("each colour has a light and a dark shade", () => {
    expect(accentShades("teal")).toEqual({ light: "#0f6f69", dark: "#4fd0c1" });
    expect(accentShades(null)).toBeNull();
  });
});
