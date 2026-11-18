import Link from "next/link";
import { z } from "zod";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { OwnReport, statusLabel } from "@/lib/moderation/types";
import { LocalTime } from "@/components/LocalTime";
import { LoadMore } from "@/components/LoadMore";
import { PAGE_SIZE } from "@/lib/paging";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";

/** What one call returns at most (it fetches one more, to tell whether there are older reports). */
const BATCH = 25;
const MAX = 500;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAgent();
  // How many to show: the first few, then more as you scroll (the address keeps it, so a refresh keeps your place).
  const count = z.coerce.number().int().min(PAGE_SIZE).max(MAX).catch(PAGE_SIZE).parse((await searchParams).n ?? PAGE_SIZE);
  const supabase = await createClient();
  const batches = await Promise.all(
    Array.from({ length: Math.ceil(count / BATCH) }, (_, i) => supabase.rpc("own_platform_reports", { p_offset: i * BATCH })),
  );
  const error = batches.find((batch) => batch.error)?.error;
  const lists = batches.map((batch) => z.array(OwnReport).safeParse(batch.data).data ?? []);
  const rows = lists.flatMap((list) => list.slice(0, BATCH));
  const olderOnServer = (lists.at(-1)?.length ?? 0) > BATCH;
  const more = rows.length > count || olderOnServer;
  return (
    <div className="space-y-4">
      <RealtimeRefresh channel="my-platform-reports" tables={["platform_notifications"]} />
      <h1 className="text-xl font-semibold">Your reports</h1>
      <p className="text-sm text-muted">Private reports sent to AGENTME about groups and communities.</p>
      {error ? (
        <p role="alert">Couldn&apos;t load your reports. Try again.</p>
      ) : rows.length ? (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface" data-testid="own-reports">
          {rows.slice(0, count).map((r) => (
            <li key={r.id}>
              <Link href={`/reports/${r.id}`} className="block p-4 hover:bg-accent-soft">
                <p className="font-medium">{r.title}</p>
                <p className="text-xs text-muted">{statusLabel(r.status, r.outcome)} · <LocalTime iso={r.created_at} /></p>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="card text-sm text-muted">You haven&apos;t submitted any reports.</p>
      )}
      {!error && more && count < MAX && <LoadMore href={`/reports?n=${count + PAGE_SIZE}`} left={olderOnServer ? undefined : rows.length - count} />}
    </div>
  );
}
