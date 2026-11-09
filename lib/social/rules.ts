/**
 * Community rules: three core rules every community has (they can't be
 * removed), plus up to five house rules picked from a list (no free text: one
 * tick, one rule, checked the same way everywhere). Pure, unit-tested.
 */

export const CORE_RULES = [
  { id: "respect", icon: "🤝", label: "Be respectful" },
  { id: "no_spam", icon: "🚫", label: "No spam or selling" },
  { id: "on_topic", icon: "🎯", label: "Stay on topic" },
] as const;

/** check: "code" = enforced before posting, free; "ai" = the autopilot can only nudge (never refuse) for these. */
export const HOUSE_RULES = [
  { id: "no_spoilers", icon: "🙊", label: "No spoilers", check: "ai" },
  { id: "language_only", icon: "🌐", label: "Write in the community's language", check: "ai" },
  { id: "no_links", icon: "🔗", label: "No links", check: "code" },
  { id: "no_media", icon: "🖼️", label: "No images or videos", check: "code" },
  { id: "no_politics", icon: "🗳️", label: "No politics", check: "ai" },
  { id: "family_friendly", icon: "🧒", label: "Keep it family-friendly", check: "ai" },
  { id: "no_self_promotion", icon: "📢", label: "No self-promotion", check: "ai" },
  { id: "no_religion", icon: "🙏", label: "No religion debates", check: "ai" },
  { id: "no_chain", icon: "🔁", label: "No reposts or chain messages", check: "ai" },
  { id: "events_only", icon: "🗓️", label: "Events and meetups only", check: "ai" },
] as const;
export type HouseRuleId = (typeof HOUSE_RULES)[number]["id"];
export const MAX_HOUSE_RULES = 5;
export const MIN_DESCRIPTION = 20;
export const MAX_DESCRIPTION = 500;
/** Long names get cut off in lists and the header. */
export const MAX_NAME = 40;

export const LANGUAGES = [
  { code: "en", name: "English", flag: "🇬🇧" },
  { code: "it", name: "Italian", flag: "🇮🇹" },
  { code: "es", name: "Spanish", flag: "🇪🇸" },
  { code: "fr", name: "French", flag: "🇫🇷" },
  { code: "de", name: "German", flag: "🇩🇪" },
  { code: "pt", name: "Portuguese", flag: "🇵🇹" },
  { code: "nl", name: "Dutch", flag: "🇳🇱" },
  { code: "pl", name: "Polish", flag: "🇵🇱" },
  { code: "ar", name: "Arabic", flag: "🇸🇦" },
  { code: "zh", name: "Chinese", flag: "🇨🇳" },
  { code: "ja", name: "Japanese", flag: "🇯🇵" },
  { code: "hi", name: "Hindi", flag: "🇮🇳" },
  { code: "mixed", name: "Mixed / any language", flag: "🌍" },
] as const;
export type LanguageCode = (typeof LANGUAGES)[number]["code"];

export const languageOf = (code: string | null | undefined) => LANGUAGES.find((l) => l.code === code) ?? null;
/** A language a "… only" rule can name (not "mixed"). */
const specificLanguage = (code: string | null | undefined) => (code && code !== "mixed" ? languageOf(code) : null);

/** "English only" when the community has a language; the generic wording otherwise. */
export function houseRuleLabel(id: string, language?: string | null): string {
  const rule = HOUSE_RULES.find((r) => r.id === id);
  if (!rule) return id;
  if (id === "language_only") return specificLanguage(language) ? `${specificLanguage(language)!.name} only` : rule.label;
  return rule.label;
}

/** The rules as members see and accept them (and as the autopilot reads them). */
export function rulesList(houseRules: readonly string[], language?: string | null) {
  return [
    ...CORE_RULES.map((r) => ({ id: r.id, icon: r.icon, label: r.label, core: true })),
    ...HOUSE_RULES.filter((r) => houseRules.includes(r.id)).map((r) => ({ id: r.id, icon: r.icon, label: houseRuleLabel(r.id, language), core: false })),
  ];
}

export const rulesText = (houseRules: readonly string[], language?: string | null) =>
  rulesList(houseRules, language)
    .map((r) => `${r.label}.`)
    .join("\n");

/** Checks what the form sent: known rules only, at most five, a language rule only with a language. */
export function cleanRules(input: { houseRules?: readonly string[]; language?: string | null }): { ok: true; houseRules: HouseRuleId[]; language: LanguageCode | null } | { ok: false; error: string } {
  const language = (input.language && languageOf(input.language) ? input.language : null) as LanguageCode | null;
  const ids = [...new Set(input.houseRules ?? [])].filter((id): id is HouseRuleId => HOUSE_RULES.some((r) => r.id === id));
  if (ids.length > MAX_HOUSE_RULES) return { ok: false, error: `Pick up to ${MAX_HOUSE_RULES} house rules.` };
  if (ids.includes("language_only") && !specificLanguage(language)) return { ok: false, error: "To use a language rule, choose the community's language first." };
  return { ok: true, houseRules: ids, language };
}

// ------------------------------------------------------------- free checks in code (house rules "No links", "No images or videos")

const MEDIA = /\.(?:jpe?g|png|gif|webp|heic|mp4|mov|webm|avi)(?:[?#]\S*)?(?=\s|$)|\b(?:youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|instagram\.com|imgur\.com|giphy\.com)\b/i;

/** A house rule a message clearly breaks, checked in code (moderators are exempt; the caller decides). */
export function houseRuleBlock(text: string, houseRules: readonly string[], links: number): string | null {
  if (houseRules.includes("no_links") && links > 0) return "This community doesn't allow links (house rule).";
  if (houseRules.includes("no_media") && MEDIA.test(text)) return "This community doesn't allow images or videos (house rule).";
  return null;
}
