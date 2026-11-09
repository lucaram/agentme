import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAgent } from "@/lib/auth";
import { dayBucket, groupNotices, KEEP_DAYS, loadNotices, refNames, type Area } from "@/lib/social/notices";
import { NoticeList } from "@/components/social/NoticeList";
import { ClearNotices } from "@/components/social/NoticeControls";
import { MarkNoticesSeen } from "@/components/social/MarkNoticesSeen";

const BUCKETS = ["Today", "Yesterday", "This week", "Older"] as const;

/** All your updates for Groups or Communities: by day, filtered by group/community, each clearable. */
export default async function UpdatesPage({ params, searchParams }: PageProps<"/updates/[area]">) {
  await requireAgent();
  const { area: raw } = await params;
  if (raw !== "groups" && raw !== "communities") notFound();
  const area: Area = raw;
  const { ref } = await searchParams;
  const filter = typeof ref === "string" && /^[0-9a-f-]{36}$/.test(ref) ? ref : null;

  const all = await loadNotices(area);
  const shown = filter ? all.filter((n) => n.ref_id === filter) : all;
  const names = await refNames(area, all.flatMap((n) => (n.ref_id ? [n.ref_id] : [])));
  const refs = [...new Set(all.flatMap((n) => (n.ref_id ? [n.ref_id] : [])))];
  const byBucket = BUCKETS.map((b) => ({ bucket: b, groups: groupNotices(shown.filter((n) => dayBucket(n.created_at) === b)) })).filter((b) => b.groups.length);
  const tab = area === "groups" ? "Groups" : "Communities";

  return (
    <div className="space-y-5">
      {all.some((n) => !n.seen_at) && <MarkNoticesSeen area={area} />}
      <div className="space-y-1">
        <Link href={`/${area}`} className="text-sm text-accent hover:underline">‹ {tab}</Link>
        <div className="flex items-center gap-3">
          <h1 className="flex-1 text-lg font-semibold">🔔 Updates</h1>
          {all.length > 0 && <ClearNotices area={area} />}
        </div>
        <p className="text-xs text-muted">About your {area}, from the last {KEEP_DAYS} days. Clear any you don&apos;t need.</p>
      </div>

      {refs.length > 1 && (
        <nav className="flex flex-wrap gap-2" aria-label="Filter updates">
          <Link href={`/updates/${area}`} className={`rounded-full border px-3 py-1 text-xs ${!filter ? "border-accent bg-accent-soft text-accent" : "border-border"}`}>
            All ({all.length})
          </Link>
          {refs.map((r) => (
            <Link
              key={r}
              href={`/updates/${area}?ref=${r}`}
              className={`rounded-full border px-3 py-1 text-xs ${filter === r ? "border-accent bg-accent-soft text-accent" : "border-border hover:bg-accent-soft"}`}
            >
              {names.get(r) ?? (area === "groups" ? "A group" : "A community")} ({all.filter((n) => n.ref_id === r).length})
            </Link>
          ))}
        </nav>
      )}

      {byBucket.length === 0 && <p className="card text-sm text-muted">No updates. You&apos;re all caught up.</p>}
      {byBucket.map(({ bucket, groups }) => (
        <section key={bucket} className="space-y-2" aria-label={bucket}>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{bucket}</h2>
          <div className="overflow-hidden rounded-2xl border border-border bg-surface">
            <NoticeList groups={groups} names={names} area={area} />
          </div>
        </section>
      ))}
    </div>
  );
}
