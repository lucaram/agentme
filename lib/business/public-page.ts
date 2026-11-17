import { z } from "zod";
import { ACCENTS } from "@/lib/appearance";

/**
 * How a business's public page (/u/{handle}, what its QR code opens) looks, and what it shows.
 * Display choices only: the agent still knows and uses everything the business gave it.
 * Hand-tuned colours, no free colour picker (the same rule as Personalise), so text stays readable.
 * Pure (unit-tested).
 */
export const PAGE_ACCENTS = ACCENTS;
export type PageAccent = (typeof ACCENTS)[number]["id"];

export const PAGE_PARTS = [
  { id: "description", label: "Description", hint: "What you wrote in About" },
  { id: "hours", label: "Opening hours", hint: "From Details (or your website)" },
  { id: "address", label: "Address", hint: "From Details (or your website)" },
  { id: "actions", label: "Customer actions", hint: "Book, order and contact buttons from Details" },
] as const;
export type PagePart = (typeof PAGE_PARTS)[number]["id"];

export type PageSettings = { accent: PageAccent | null; show: Record<PagePart, boolean> };

const Stored = z
  .object({
    accent: z.string().nullish(),
    show: z.record(z.string(), z.boolean()).nullish(),
  })
  .partial();

/** The page settings in business_info.page, with anything unknown or missing at its default (everything shown, the app's own colours). */
export function pageSettings(businessInfo: unknown): PageSettings {
  const raw = Stored.safeParse((businessInfo as { page?: unknown } | null)?.page ?? {});
  const value = raw.success ? raw.data : {};
  const accent = PAGE_ACCENTS.find((a) => a.id === value.accent)?.id ?? null;
  const show = Object.fromEntries(PAGE_PARTS.map((p) => [p.id, value.show?.[p.id] !== false])) as Record<PagePart, boolean>;
  return { accent, show };
}

/** From the form: only known parts and accents. */
export function pageSettingsFrom(form: { accent?: unknown; show?: unknown }): PageSettings {
  const accent = PAGE_ACCENTS.find((a) => a.id === form.accent)?.id ?? null;
  const chosen = Array.isArray(form.show) ? form.show : [];
  const show = Object.fromEntries(PAGE_PARTS.map((p) => [p.id, chosen.includes(p.id)])) as Record<PagePart, boolean>;
  return { accent, show };
}

/** The accent's light and dark shades, for the page's own colour (null: the viewer's own app colours). */
export function accentShades(accent: PageAccent | null): { light: string; dark: string } | null {
  const a = PAGE_ACCENTS.find((x) => x.id === accent);
  return a ? { light: a.light, dark: a.dark } : null;
}

export const COVER_WIDTH = 1200;
export const COVER_HEIGHT = 400;
export const COVER_IMAGE = /^\/api\/covers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
export const coverUrl = (id: string) => `/api/covers/${id}`;

/**
 * On the page's <main>: take the button colour from --page-accent-light / --page-accent-dark (set
 * alongside). Only when a colour is chosen; the preview in My Business adds and removes it live.
 */
export const PAGE_ACCENT_CLASSES = "page-accented [--accent:var(--page-accent-light)] [--color-accent:var(--page-accent-light)] dark:[--accent:var(--page-accent-dark)] dark:[--color-accent:var(--page-accent-dark)]";
