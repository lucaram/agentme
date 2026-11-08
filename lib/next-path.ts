/** Only same-site paths ("/join/abc"), never "//evil.com" or full URLs. */
export function safeNext(next: unknown, fallback = "/chats"): string {
  const value = typeof next === "string" ? next : "";
  return value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : fallback;
}
