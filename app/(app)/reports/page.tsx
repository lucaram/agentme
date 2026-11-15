import Link from "next/link";
import { z } from "zod";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { OwnReport, statusLabel } from "@/lib/moderation/types";
import { LocalTime } from "@/components/LocalTime";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAgent(); const page = z.coerce.number().int().min(0).max(400).catch(0).parse((await searchParams).page ?? 0);
  const { data, error } = await (await createClient()).rpc("own_platform_reports", { p_offset: page * 25 }); const rows = z.array(OwnReport).safeParse(data).data ?? [];
  return <div className="space-y-4"><RealtimeRefresh channel="my-platform-reports" tables={["platform_notifications"]} /><h1 className="text-xl font-semibold">Your reports</h1><p className="text-sm text-muted">Private reports sent to AGENTME about groups and communities.</p>{error ? <p role="alert">Couldn&apos;t load your reports. Try again.</p> : rows.length ? <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">{rows.slice(0, 25).map((r) => <li key={r.id}><Link href={`/reports/${r.id}`} className="block p-4 hover:bg-accent-soft"><p className="font-medium">{r.title}</p><p className="text-xs text-muted">{statusLabel(r.status, r.outcome)} · <LocalTime iso={r.created_at} /></p></Link></li>)}</ul> : <p className="card text-sm text-muted">You haven&apos;t submitted any reports.</p>}<div className="flex gap-3 text-sm">{page > 0 && <Link href={`/reports?page=${page - 1}`} className="text-accent underline">Newer reports</Link>}{rows.length > 25 && <Link href={`/reports?page=${page + 1}`} className="text-accent underline">Older reports</Link>}</div></div>;
}
