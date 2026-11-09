/** Agent avatars: people pick from AVATARS, businesses from BUSINESS_AVATARS. */
export const AVATARS = ["🦊", "🐻", "🦉", "🐼", "🐙", "🦁", "🐢", "🌻", "🚀", "🍝", "☕", "🎸"];
export const BUSINESS_AVATARS = ["🏪", "🍝", "☕", "🍕", "💇", "🛠️", "🏋️", "🛍️", "🎨", "🩺"];

/** What an agent can change its avatar to; the one it has now is always kept as a choice (e.g. a business that signed up with 🦊). */
export function avatarsFor(type: "personal" | "business" | string, current?: string | null): string[] {
  const list = type === "business" ? BUSINESS_AVATARS : AVATARS;
  return current && !list.includes(current) ? [current, ...list] : list;
}
