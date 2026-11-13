import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE, appearanceAttributes, appearanceSummary, parseAppearance, serializeAppearance } from "@/lib/appearance";

describe("Personalise", () => {
  it("round-trips through the cookie", () => {
    const look = { theme: "dark", accent: "purple", text: "large", dark: "black", tint: "tinted" } as const;
    expect(serializeAppearance(look)).toBe("dark.purple.large.black.tinted");
    expect(parseAppearance(serializeAppearance(look))).toEqual(look);
    // A cookie saved before the background choice existed: everything kept, background neutral.
    expect(parseAppearance("dark.purple.large.black")).toEqual({ ...look, tint: "plain" });
  });

  it("anything unknown falls back to the defaults, one setting at a time", () => {
    expect(parseAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance("neon.red.huge")).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance({ theme: "light", accent: "#ff0000" })).toEqual({ ...DEFAULT_APPEARANCE, theme: "light" });
    // No free colours for the background either: only the choices offered.
    expect(parseAppearance({ tint: "#123456" }).tint).toBe("plain");
  });

  it("sets the attributes the CSS follows", () => {
    expect(appearanceAttributes(DEFAULT_APPEARANCE)).toEqual({ "data-theme": "system", "data-accent": "green", "data-text": "standard", "data-dark": "dim", "data-tint": "plain" });
    expect(appearanceAttributes({ ...DEFAULT_APPEARANCE, tint: "tinted" })["data-tint"]).toBe("tinted");
  });

  it("summarises for the Settings list (dark style only when it can apply)", () => {
    expect(appearanceSummary(DEFAULT_APPEARANCE)).toBe("System · Green · Standard text");
    expect(appearanceSummary({ theme: "dark", accent: "blue", text: "xl", dark: "black", tint: "plain" })).toBe("Dark · Blue · Extra large text · Black");
    expect(appearanceSummary({ theme: "light", accent: "teal", text: "large", dark: "black", tint: "plain" })).toBe("Light · Teal · Large text");
    expect(appearanceSummary({ theme: "light", accent: "teal", text: "large", dark: "dim", tint: "tinted" })).toBe("Light · Teal · Large text · Tinted");
  });
});
