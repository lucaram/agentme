/**
 * Turning what people type or export from their phone into comparable values.
 * Pure functions: used on the server (authoritative) and in tests.
 */

const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;

export function normaliseEmail(raw: string): string | null {
  const value = raw.trim().replace(/^mailto:/i, "").toLowerCase();
  return EMAIL.test(value) && value.length <= 254 ? value : null;
}

/** "+44", "44" or "0044" -> "+44"; anything else -> null. */
export function normaliseCountryCode(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").trim().replace(/^(\+|00)/, "").replace(/\D/g, "");
  return digits.length >= 1 && digits.length <= 3 && !digits.startsWith("0") ? `+${digits}` : null;
}

/**
 * International format (E.164-like): "+447700900123".
 * Numbers written without a country code ("07700 900123") use `defaultCode`
 * and lose their leading 0 (the national trunk prefix in most countries).
 */
export function normalisePhone(raw: string, defaultCode?: string | null): string | null {
  let value = raw.trim().replace(/^tel:/i, "");
  if (/[a-z@]/i.test(value)) return null;
  value = value.replace(/[\s().\-/]/g, "");
  if (value.startsWith("00")) value = `+${value.slice(2)}`;
  if (!value.startsWith("+")) {
    const code = normaliseCountryCode(defaultCode);
    if (!code) return null;
    value = `${code}${value.replace(/^0/, "")}`;
  }
  const digits = value.slice(1);
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}

export type Identifier = { kind: "email" | "phone"; value: string };

/** One raw entry (an email or a phone number) -> a normalised identifier. */
export function toIdentifier(raw: string, defaultCode?: string | null): Identifier | null {
  if (raw.includes("@")) {
    const email = normaliseEmail(raw);
    return email ? { kind: "email", value: email } : null;
  }
  const phone = normalisePhone(raw, defaultCode);
  return phone ? { kind: "phone", value: phone } : null;
}

export const MAX_ENTRIES = 5000;

/**
 * Emails and phone numbers found in an exported address book (vCard .vcf from
 * iPhone/Android/Google/Outlook) or in pasted text/CSV. Only these two kinds
 * of values are kept; names and everything else are ignored.
 */
export function extractEntries(text: string): string[] {
  const found = new Set<string>();
  if (/BEGIN:VCARD/i.test(text)) {
    // Unfold continuation lines, then read EMAIL/TEL properties (with or without "item1." groups).
    for (const line of text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
      const m = line.match(/^(?:[\w-]+\.)?(EMAIL|TEL)(?:;[^:]*)?:(.+)$/i);
      if (m) found.add(m[2].trim());
    }
  } else {
    for (const m of text.matchAll(/[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}/gi)) found.add(m[0]);
    const withoutEmails = text.replace(/[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}/gi, " ");
    for (const m of withoutEmails.matchAll(/(?:\+|00)?\d[\d\s().-]{6,}\d/g)) found.add(m[0].trim());
  }
  return [...found].slice(0, MAX_ENTRIES);
}

/** What the owner sees of their own identifiers: "l•••@hotmail.com", "+44 ••• 0123". */
export function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 1)}•••@${domain}`;
}
export function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)} ••• ${phone.slice(-4)}`;
}
