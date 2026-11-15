import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { platformModerator, platformOperator } from "@/lib/moderation/access";
import { LocalTime } from "@/components/LocalTime";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";

const Case = z.object({ id: z.uuid(), title: z.string(), target_kind: z.string(), status: z.string(), created_at: z.string(), reports: z.number() });
export default async function ModerationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAgent(); if (!await platformModerator()) notFound();
  const query = await searchParams; const state = query.state === "closed" ? "closed" : query.state === "waiting" ? "waiting" : "pending"; const page = z.coerce.number().int().min(0).max(400).catch(0).parse(query.page ?? 0);
  const { data, error } = await (await createClient()).rpc("platform_case_queue", { p_state: state, p_offset: page * 25 });
  const cases = z.array(Case).safeParse(data).data ?? [];
  const operator = await platformOperator();
  return <div className="space-y-4"><RealtimeRefresh channel="platform-case-queue" tables={["platform_cases"]} /><h1 className="text-xl font-semibold">Platform moderation</h1><p className="text-sm text-muted">Message, group and community reports. Reviewers see submitted evidence, without general chat access. Cases you are involved in are excluded.</p>
    <nav className="flex flex-wrap gap-2" aria-label="Report queues"><Link className={state === "pending" ? "btn-primary" : "btn-ghost"} href="/moderation">Needs review</Link><Link className={state === "waiting" ? "btn-primary" : "btn-ghost"} href="/moderation?state=waiting">Waiting for evidence</Link><Link className={state === "closed" ? "btn-primary" : "btn-ghost"} href="/moderation?state=closed">Closed cases</Link><Link className="btn-ghost" href="/moderation/appeals">Account appeals</Link>{operator && <Link className="btn-ghost" href="/moderation/staff">Manage staff</Link>}</nav>
    {error ? <p role="alert" className="text-sm text-danger">Couldn&apos;t load the queue. Refresh and try again.</p> : cases.length ? <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">{cases.slice(0, 25).map((c) => <li key={c.id}><Link href={`/moderation/${c.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-accent-soft"><div><p className="font-medium">{c.title}</p><p className="text-xs text-muted">{c.target_kind} · {c.reports} {c.reports === 1 ? "report" : "reports"} · {c.status === "waiting_evidence" ? "Waiting for evidence" : c.status === "in_review" ? "Under review" : c.status === "open" ? "New" : "Closed"}</p></div><span className="shrink-0 text-xs text-muted"><LocalTime iso={c.created_at} /></span></Link></li>)}</ul> : <p className="card text-sm text-muted">No cases in this queue.</p>}
    <div className="flex gap-3 text-sm">{page > 0 && <Link className="text-accent underline" href={`/moderation?state=${state}&page=${page - 1}`}>Newer cases</Link>}{cases.length > 25 && <Link className="text-accent underline" href={`/moderation?state=${state}&page=${page + 1}`}>Older cases</Link>}</div>
  </div>;
}
