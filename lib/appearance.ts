/**
 * Personalise: how the app looks to you. Hand-tuned choices only (no free
 * colour picker), so text stays readable in Light and Dark. Red (warnings)
 * and the agent's bubbles are never themed. Pure, unit-tested.
 */

export const THEMES = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
] as const;

/** Each accent is a tested pair: dark enough for white text in Light, bright enough for black text in Dark. */
export const ACCENTS = [
  { id: "green", label: "Green", light: "#2f6b4f", dark: "#6fbf95" },
  { id: "blue", label: "Blue", light: "#1f5fbf", dark: "#6ea8f5" },
  { id: "purple", label: "Purple", light: "#6d3fc4", dark: "#b096f7" },
  { id: "pink", label: "Pink", light: "#b4246a", dark: "#f17fb5" },
  { id: "orange", label: "Orange", light: "#b8480f", dark: "#f59a52" },
  { id: "teal", label: "Teal", light: "#0f6f69", dark: "#4fd0c1" },
] as const;

export const TEXT_SIZES = [
  { id: "standard", label: "Standard" },
  { id: "large", label: "Large" },
  { id: "xl", label: "Extra large" },
] as const;

export const DARK_STYLES = [
  { id: "dim", label: "Dim" },
  { id: "black", label: "Black" },
] as const;

type Id<T extends readonly { id: string }[]> = T[number]["id"];
export type Appearance = { theme: Id<typeof THEMES>; accent: Id<typeof ACCENTS>; text: Id<typeof TEXT_SIZES>; dark: Id<typeof DARK_STYLES> };

export const DEFAULT_APPEARANCE: Appearance = { theme: "system", accent: "green", text: "standard", dark: "dim" };
/** Remembered on the device so the page is drawn in your colours straight away (no flash). */
export const APPEARANCE_COOKIE = "agentme_look";

const pick = <T extends readonly { id: string }[]>(list: T, value: unknown, fallback: Id<T>): Id<T> =>
  (list.some((o) => o.id === value) ? value : fallback) as Id<T>;

/** From the cookie ("dark.blue.large.black"), the saved account value ({theme, …}) or anything else: always a valid appearance. */
export function parseAppearance(raw: unknown): Appearance {
  let v: Record<string, unknown> = {};
  if (typeof raw === "string") {
    const [theme, accent, text, dark] = raw.split(".");
    v = { theme, accent, text, dark };
  } else if (raw && typeof raw === "object") v = raw as Record<string, unknown>;
  return {
    theme: pick(THEMES, v.theme, DEFAULT_APPEARANCE.theme),
    accent: pick(ACCENTS, v.accent, DEFAULT_APPEARANCE.accent),
    text: pick(TEXT_SIZES, v.text, DEFAULT_APPEARANCE.text),
    dark: pick(DARK_STYLES, v.dark, DEFAULT_APPEARANCE.dark),
  };
}

export const serializeAppearance = (a: Appearance) => [a.theme, a.accent, a.text, a.dark].join(".");

/** The attributes on <html> that the colour tokens in globals.css follow. */
export const appearanceAttributes = (a: Appearance) => ({ "data-theme": a.theme, "data-accent": a.accent, "data-text": a.text, "data-dark": a.dark });

const label = <T extends readonly { id: string; label: string }[]>(list: T, id: string) => list.find((o) => o.id === id)?.label ?? id;

/** "Dark · Blue · Large text" (+ "· Black" when the black dark style can apply). */
export function appearanceSummary(a: Appearance): string {
  return [
    label(THEMES, a.theme),
    label(ACCENTS, a.accent),
    `${label(TEXT_SIZES, a.text)} text`,
    ...(a.dark === "black" && a.theme !== "light" ? ["Black"] : []),
  ].join(" · ");
}
