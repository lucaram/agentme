/** Each request fetches one chunk; older history remains accessible beyond the bounded DOM window. */
export const MESSAGES_PER_PAGE = 50;
export const MAX_RENDERED_MESSAGES = 150;
const micros = (iso: string) => Number((iso.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0").slice(3, 6));
export function compareMessages(a: { created_at: string; id: string }, b: { created_at: string; id: string }) {
  return Date.parse(a.created_at) - Date.parse(b.created_at) || micros(a.created_at) - micros(b.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
