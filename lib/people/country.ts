/**
 * The calling code for numbers saved without one ("07700 900123"), detected
 * from the device: its time zone first (where you are), then its language
 * region. Pure, so it runs in the browser and in tests.
 */

const BY_ZONE: Record<string, string> = {
  "Europe/London": "+44", "Europe/Belfast": "+44", "Europe/Dublin": "+353", "Europe/Rome": "+39", "Europe/Paris": "+33",
  "Europe/Berlin": "+49", "Europe/Madrid": "+34", "Europe/Lisbon": "+351", "Europe/Amsterdam": "+31", "Europe/Brussels": "+32",
  "Europe/Zurich": "+41", "Europe/Vienna": "+43", "Europe/Stockholm": "+46", "Europe/Oslo": "+47", "Europe/Copenhagen": "+45",
  "Europe/Warsaw": "+48", "Europe/Athens": "+30", "America/Mexico_City": "+52", "America/Sao_Paulo": "+55",
  "Asia/Kolkata": "+91", "Asia/Calcutta": "+91", "Asia/Tokyo": "+81", "Asia/Singapore": "+65", "Pacific/Auckland": "+64",
};
const NORTH_AMERICA = /^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit|Toronto|Vancouver|Edmonton|Winnipeg|Halifax|Indiana\/.+|Kentucky\/.+|Boise)$/;

const BY_REGION: Record<string, string> = {
  GB: "+44", IE: "+353", IT: "+39", US: "+1", CA: "+1", FR: "+33", DE: "+49", ES: "+34", PT: "+351", NL: "+31", BE: "+32",
  CH: "+41", AT: "+43", SE: "+46", NO: "+47", DK: "+45", PL: "+48", GR: "+30", AU: "+61", NZ: "+64", IN: "+91", BR: "+55",
  MX: "+52", JP: "+81", SG: "+65",
};

export function codeFromTimeZone(zone: string | undefined): string | null {
  if (!zone) return null;
  if (BY_ZONE[zone]) return BY_ZONE[zone];
  if (NORTH_AMERICA.test(zone)) return "+1";
  if (zone.startsWith("Australia/")) return "+61";
  return null;
}

export function codeFromLanguage(language: string | undefined): string | null {
  const region = language?.split(/[-_]/)[1]?.toUpperCase();
  return (region && BY_REGION[region]) || null;
}

/** Best guess on this device, or null (then only numbers with a country code are used). */
export function detectCountryCode(): string | null {
  try {
    return codeFromTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? codeFromLanguage(navigator.language);
  } catch {
    return null;
  }
}
