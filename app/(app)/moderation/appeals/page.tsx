import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { platformModerator } from "@/lib/moderation/access";
import { actionLabel } from "@/lib/moderation/types";
import { LocalTime } from "@/components/LocalTime";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { ReviewAccountAppealForm } from "@/components/moderation/AccountAppealForms";

const Appeal = z.object({ id: z.uuid(), reason: z.string(), status: z.string(), created_at: z.string(), response: z.string().nullable(), reviewed_at: z.string().nullable(), sanction_id: z.uuid(), subject_name: z.string(), action: z.string(), justification: z.string(), expires_at: z.string().nullable(), revoked_at: z.string().nullable(), case_id: z.uuid() });
export default async function AccountAppealsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAgent(); if (!await platformModerator()) notFound();
  const query = await searchParams; const state = query.state === "closed" ? "closed" : "open"; const page = z.coerce.number().int().min(0).max(400).catch(0).parse(query.page ?? 0);
  const { data, error } = await (await createClient()).rpc("account_appeal_queue", { p_state: state, p_offset: page * 25 }); const appeals = z.array(Appeal).safeParse(data).data ?? [];
  return <div className="space-y-4"><RealtimeRefresh channel="account-appeal-queue" tables={["platform_account_appeals", "platform_account_sanctions"]} /><Link className="text-accent text-sm" href="/moderation">‹ Platform moderation</Link><h1 className="text-xl font-semibold">Account appeals</h1><p className="text-sm text-muted">Only appeals you can review independently are shown. You cannot review your own enforcement decision or a case you are involved in.</p><nav className="flex gap-2"><Link className={state === "open" ? "btn-primary" : "btn-ghost"} href="/moderation/appeals">Needs review</Link><Link className={state === "closed" ? "btn-primary" : "btn-ghost"} href="/moderation/appeals?state=closed">Reviewed appeals</Link></nav>
    {error ? <p role="alert" className="text-sm text-danger">Couldn&apos;t load appeals. Please refresh.</p> : !appeals.length && <p className="card text-sm text-muted">No appeals in this queue.</p>}
    {appeals.slice(0, 25).map((appeal) => <article key={appeal.id} className="card space-y-3" data-testid="account-appeal"><h2 className="font-semibold">{appeal.subject_name} · {actionLabel(appeal.action)}</h2><p className="text-xs text-muted">Appeal received <LocalTime iso={appeal.created_at} full /></p><p className="text-sm">Original justification: {appeal.justification}</p><p className="whitespace-pre-wrap break-words text-sm">Appeal: {appeal.reason}</p>{appeal.revoked_at && <p className="text-sm text-muted">This restriction has already been lifted. The appeal can still be reviewed for the record.</p>}<Link className="text-sm text-accent underline" href={`/moderation/${appeal.case_id}`}>View case and submitted evidence</Link>{appeal.status === "open" ? <ReviewAccountAppealForm id={appeal.id} /> : <><p className="text-sm font-medium">Appeal {appeal.status}</p><p className="whitespace-pre-wrap text-sm">Justification: {appeal.response}</p>{appeal.reviewed_at && <p className="text-xs text-muted"><LocalTime iso={appeal.reviewed_at} full /></p>}</>}</article>)}
    <div className="flex gap-3 text-sm">{page > 0 && <Link className="text-accent underline" href={`/moderation/appeals?state=${state}&page=${page - 1}`}>Previous</Link>}{appeals.length > 25 && <Link className="text-accent underline" href={`/moderation/appeals?state=${state}&page=${page + 1}`}>More appeals</Link>}</div>
  </div>;
}
