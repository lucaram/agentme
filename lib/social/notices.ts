import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Updates in the Groups/Communities tabs, kept manageable when there are many:
 * those that need you are pinned until handled; repeats about the same group
 * or community on the same day are grouped; you can clear them; they expire
 * after 30 days.
 */
export type Area = "groups" | "communities";
export type NoticeRow = {
  id: string;
  text: string;
  link: string | null;
  created_at: string;
  seen_at: string | null;
  ref_id: string | null;
  kind: string;
  needs_action: boolean;
  resolved_at: string | null;
};
export type NoticeGroup = { key: string; refId: string | null; items: NoticeRow[] };

export const KEEP_DAYS = 30;
const COLUMNS = "id, text, link, created_at, seen_at, ref_id, kind, needs_action, resolved_at";

/** Your updates (RLS: only your own), newest first, not cleared, from the last 30 days. */
export async function loadNotices(area: Area, opts: { ref?: string | null; limit?: number } = {}): Promise<NoticeRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("notices")
    .select(COLUMNS)
    .eq("area", area)
    .is("dismissed_at", null)
    .gte("created_at", new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString())
    .order("created_at", { ascending: false });
  if (opts.ref) query = query.eq("ref_id", opts.ref);
  const { data } = await query.limit(opts.limit ?? 300);
  return (data ?? []) as NoticeRow[];
}

/** Still needs you (e.g. an appeal to review): pinned at the top until handled or cleared. */
export const needsYou = (n: NoticeRow) => n.needs_action && !n.resolved_at;

/** Repeats about the same group/community on the same day become one expandable line. */
export function groupNotices(rows: NoticeRow[]): NoticeGroup[] {
  const groups: NoticeGroup[] = [];
  const byKey = new Map<string, NoticeGroup>();
  for (const n of rows) {
    const key = n.ref_id ? `${n.ref_id}:${n.created_at.slice(0, 10)}` : n.id;
    const existing = byKey.get(key);
    if (existing) existing.items.push(n);
    else {
      const g = { key, refId: n.ref_id, items: [n] };
      byKey.set(key, g);
      groups.push(g);
    }
  }
  return groups;
}

/** Group or community names for the filter and grouped lines (the server reads them: you may no longer be a member). */
export async function refNames(area: Area, refIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(refIds)];
  if (!ids.length) return new Map();
  const db = adminClient();
  if (area === "groups") {
    const { data } = await db.from("conversations").select("id, title").in("id", ids);
    return new Map((data ?? []).map((c) => [c.id, c.title ?? "a group"]));
  }
  const { data } = await db.from("communities").select("id, name").in("id", ids);
  return new Map((data ?? []).map((c) => [c.id, c.name]));
}

/** "Today", "Yesterday", "This week", "Older" (by the server's date). */
export function dayBucket(iso: string, now = Date.now()): "Today" | "Yesterday" | "This week" | "Older" {
  const day = (t: number) => Math.floor(t / 86_400_000);
  const diff = day(now) - day(Date.parse(iso));
  return diff <= 0 ? "Today" : diff === 1 ? "Yesterday" : diff < 7 ? "This week" : "Older";
}

/** Clear one of your updates, or all of them in a tab. */
export async function dismissNotices(userId: string, area: Area, id?: string) {
  let query = adminClient().from("notices").update({ dismissed_at: new Date().toISOString() }).eq("user_id", userId).eq("area", area).is("dismissed_at", null);
  if (id) query = query.eq("id", id);
  await query;
}
