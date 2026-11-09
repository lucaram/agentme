import Link from "next/link";
import { LocalTime } from "@/components/LocalTime";
import type { Area, NoticeGroup, NoticeRow } from "@/lib/social/notices";
import { DismissNotice } from "./NoticeControls";

function Row({ n, area }: { n: NoticeRow; area: Area }) {
  return (
    <li className={`flex items-baseline gap-3 px-5 py-3 text-sm sm:px-6 ${n.seen_at ? "text-muted" : "font-medium"}`} data-testid="notice">
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
      <span className="shrink-0 text-xs text-muted">
        <LocalTime iso={n.created_at} />
      </span>
      <DismissNotice area={area} id={n.id} />
    </li>
  );
}

/** Updates, with repeats about the same group/community on the same day folded into one line. */
export function NoticeList({ groups, names, area }: { groups: NoticeGroup[]; names: Map<string, string>; area: Area }) {
  return (
    <ul className="divide-y divide-border" aria-label="Updates">
      {groups.map((g) =>
        g.items.length === 1 ? (
          <Row key={g.key} n={g.items[0]} area={area} />
        ) : (
          <li key={g.key}>
            <details className="group/notices">
              <summary className="flex cursor-pointer items-baseline gap-3 px-5 py-3 text-sm sm:px-6" data-testid="notice-group">
                <span className="min-w-0 flex-1">
                  {g.items.some((n) => !n.seen_at) && <span className="mr-1 inline-block h-2 w-2 rounded-full bg-accent" aria-label="new" />}
                  <span className="font-medium">
                    {g.items.length} updates about “{(g.refId && names.get(g.refId)) || (area === "groups" ? "a group" : "a community")}”
                  </span>
                  <span className="block truncate text-xs text-muted">Latest: {g.items[0].text}</span>
                </span>
                <span className="shrink-0 text-xs text-muted">
                  <LocalTime iso={g.items[0].created_at} />
                </span>
                <span className="text-muted transition group-open/notices:rotate-90" aria-hidden>›</span>
              </summary>
              <ul className="divide-y divide-border border-t border-border bg-background/50">
                {g.items.map((n) => (
                  <Row key={n.id} n={n} area={area} />
                ))}
              </ul>
            </details>
          </li>
        ),
      )}
    </ul>
  );
}
