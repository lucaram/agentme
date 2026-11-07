export const HANDLE_PATTERN = /^[a-z0-9_]{3,20}$/;

const RESERVED = new Set([
  "admin", "agentme", "api", "help", "login", "logout", "me", "root",
  "settings", "signup", "support", "system", "anthropic", "official",
]);

/** "@Luca " -> "luca" */
export function normalizeHandle(input: string): string {
  return input.trim().replace(/^@+/, "").toLowerCase();
}

export type HandleCheck = { ok: true; handle: string } | { ok: false; handle: string; reason: string };

export function validateHandle(input: string): HandleCheck {
  const handle = normalizeHandle(input);
  if (handle.length < 3) return { ok: false, handle, reason: "At least 3 characters." };
  if (handle.length > 20) return { ok: false, handle, reason: "At most 20 characters." };
  if (!HANDLE_PATTERN.test(handle)) {
    return { ok: false, handle, reason: "Use lowercase letters, numbers and underscores only." };
  }
  if (RESERVED.has(handle)) return { ok: false, handle, reason: "That address is reserved." };
  return { ok: true, handle };
}

/** Distinct @mentions in a message, normalised, in order of appearance. */
export function extractMentions(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(/(?:^|[^a-z0-9_@])@([a-z0-9_]{3,20})\b/gi)) {
    seen.add(match[1].toLowerCase());
  }
  return [...seen];
}
