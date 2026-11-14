import { itemKey, learnedOf } from "./learn";

export function businessDescription(raw: unknown): string {
  const info = (raw ?? {}) as { about?: string; description?: string };
  return info.about?.trim() || info.description?.trim() || "";
}

/** Owner values override the reviewed public website. Empty overrides clear a value. */
export function publicBusinessDetails(raw: unknown, site?: { live_at: string | null; learned: unknown; hidden: readonly string[] } | null) {
  const info = (raw ?? {}) as { hours?: string; address?: string; corrections?: { label: string; value: string }[] };
  const learned = site?.live_at ? learnedOf(site.learned) : null;
  const value = (key: "hours" | "address") => {
    const correction = info.corrections?.find((item) => (key === "hours" ? /^(opening hours|hours)$/i : /^(business address|address)$/i).test(item.label.trim()));
    return correction?.value ?? (typeof info[key] === "string" ? info[key] : learned && !site!.hidden.includes(itemKey.basic(key)) ? learned[key] : "");
  };
  return { hours: value("hours"), address: value("address") };
}
