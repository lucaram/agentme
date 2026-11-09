import Link from "next/link";
import { Fold } from "@/components/Fold";
import { groupNotices, loadNotices, needsYou, refNames } from "@/lib/social/notices";
import { MarkNoticesSeen } from "./MarkNoticesSeen";
import { NoticeList } from "./NoticeList";
import { ClearNotices, DismissNotice } from "./NoticeControls";

const SHOWN = 5;

/**
 * Updates about your groups/communities (you were removed, a request was
 * answered, an appeal waits…). What needs you is pinned on top until handled;
 * then the latest few, with repeats grouped; "See all" opens the full list.
 * New ones count in the tab badge until seen.
 */
export async function Notices({ area }: { area: "groups" | "communities" }) {
  const notices = await loadNotices(area);
  if (!notices.length) return null;
  const pinned = notices.filter(needsYou);
  const groups = groupNotices(notices.filter((n) => !needsYou(n)));
  const names = await refNames(area, notices.flatMap((n) => (n.ref_id ? [n.ref_id] : [])));
  const unseen = notices.filter((n) => !n.seen_at).length;

  return (
    <Fold
      icon="🔔"
      title="Updates"
      testId="notices"
      open={unseen > 0 || pinned.length > 0}
      // New updates in green; otherwise how many there are (last 30 days).
      badge={unseen > 0 ? { count: unseen, tone: "new" } : { count: notices.length, tone: "total" }}
      summary={pinned.length ? `${pinned.length} ${pinned.length === 1 ? "needs" : "need"} you · ${pinned[0].text}` : unseen ? `${unseen} new · ${notices[0].text}` : `Latest: ${notices[0].text}`}
    >
      {unseen > 0 && <MarkNoticesSeen area={area} />}
      {pinned.length > 0 && (
        <ul className="divide-y divide-border border-b border-border bg-accent-soft/40" aria-label="Needs you">
          {pinned.map((n) => (
            <li key={n.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm sm:px-6" data-testid="notice-pinned">
              <span className="min-w-0 flex-1 font-medium">📌 {n.text}</span>
              {n.link && <Link href={n.link} className="btn-primary py-1">Review ›</Link>}
              <DismissNotice area={area} id={n.id} />
            </li>
          ))}
        </ul>
      )}
      <NoticeList groups={groups.slice(0, SHOWN)} names={names} area={area} />
      <div className="flex items-center gap-3 border-t border-border px-5 py-3 sm:px-6">
        {groups.length > SHOWN ? (
          <Link href={`/updates/${area}`} className="text-sm font-medium text-accent hover:underline" data-testid="see-all-updates">
            See all updates ({notices.length}) ›
          </Link>
        ) : (
          <span className="text-xs text-muted">Updates are kept for 30 days.</span>
        )}
        <span className="flex-1" />
        <ClearNotices area={area} />
      </div>
    </Fold>
  );
}
