import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LocalTime } from "@/components/LocalTime";
import { MarkNoticesSeen } from "./MarkNoticesSeen";
import { daysAgo } from "@/lib/social/shared";

/**
 * Updates about your groups/communities: you were removed or banned, a group
 * was deleted, your request was approved or declined, you were muted or made
 * admin/moderator. New ones count in the tab badge until you've seen them.
 */
export async function Notices({ area }: { area: "groups" | "communities" }) {
  const supabase = await createClient();
  const since = daysAgo(30);
  // RLS: only your own updates.
  const { data: notices } = await supabase.from("notices").select("*").eq("area", area).gte("created_at", since).order("created_at", { ascending: false }).limit(10);
  if (!notices?.length) return null;
  const unseen = notices.some((n) => !n.seen_at);
  return (
    <section className="card space-y-2" aria-label="Updates" data-testid="notices">
      {unseen && <MarkNoticesSeen area={area} />}
      <h2 className="font-semibold">Updates</h2>
      <ul className="divide-y divide-border">
        {notices.map((n) => (
          <li key={n.id} className={`flex flex-wrap items-baseline gap-x-3 py-2 text-sm ${n.seen_at ? "text-muted" : "font-medium"}`} data-testid="notice">
            <span className="min-w-0 flex-1">
              {!n.seen_at && <span className="mr-1 inline-block h-2 w-2 rounded-full bg-accent" aria-label="new" />}
              {n.link ? (
                <Link href={n.link} className="hover:underline">
                  {n.text}
                </Link>
              ) : (
                n.text
              )}
            </span>
            <span className="text-xs text-muted">
              <LocalTime iso={n.created_at} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
