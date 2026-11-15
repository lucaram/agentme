import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { platformModerator } from "@/lib/moderation/access";
import { Evidence, EvidenceRequest, statusLabel, AccountPerson, actionLabel } from "@/lib/moderation/types";
import { LocalTime } from "@/components/LocalTime";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { ReviewCaseForm } from "@/components/moderation/ReviewCaseForm";
import { EvidenceList } from "@/components/moderation/EvidenceList";
import { RequestEvidenceForm } from "@/components/moderation/EvidenceFollowup";
import { LiftRestrictionForm } from "@/components/moderation/LiftRestrictionForm";

export default async function CasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAgent(); if (!await platformModerator()) notFound(); const { id } = await params; if (!z.uuid().safeParse(id).success) notFound();
  const db = await createClient(); const { data: item } = await db.from("platform_cases").select("*").eq("id", id).maybeSingle(); if (!item) notFound();
  const page = z.coerce.number().int().min(0).max(400).catch(0).parse((await searchParams).page ?? 0);
  const [{ data: reports }, { data: events }, { data: suspended }, { data: rawRequests }, { data: candidates }, { data: sanctions }] = await Promise.all([
    db.from("platform_reports").select("id,category,reason,evidence,created_at").eq("case_id", id).order("created_at").order("id").range(page * 25, page * 25 + 25),
    db.from("platform_case_events").select("*").eq("case_id", id).order("created_at", { ascending: false }).limit(50),
    db.rpc("platform_case_suspended", { p_case: id }),
    db.from("platform_evidence_requests").select("id,report_id,question,status,reply,evidence,created_at,answered_at").eq("case_id", id).order("created_at"),
    db.rpc("account_case_people", { p_case: id }),
    db.from("platform_account_sanctions").select("*").eq("case_id", id).order("created_at", { ascending: false }),
  ]);
  const people = z.array(AccountPerson).safeParse(candidates).data ?? [];
  const requests = z.array(EvidenceRequest.extend({ report_id: z.uuid() })).safeParse(rawRequests).data ?? [];
  const actorIds = [...new Set((events ?? []).map((e) => e.actor_id).filter((actor): actor is string => Boolean(actor)))];
  const { data: actors } = actorIds.length ? await db.from("agents").select("owner_id,display_name").in("owner_id", actorIds) : { data: [] };
  const isMessage = item.target_kind === "message";
  const deleted = isMessage ? !item.message_id : item.target_kind === "group" ? !item.group_id : !item.community_id;
  return <div className="space-y-4"><RealtimeRefresh channel={`platform-case-${id}`} tables={["platform_cases"]} /><Link href="/moderation" className="text-sm text-accent">‹ Platform moderation</Link><div><h1 className="text-xl font-semibold">{item.title}</h1><p className="text-xs text-muted">Case {id.slice(0, 8).toUpperCase()} · {item.target_kind} · {statusLabel(item.status, item.outcome)} · <LocalTime iso={item.created_at} /></p></div>
    {(item.description || item.rules) && <section className="card space-y-2 text-sm"><h2 className="font-medium">Space information when reported</h2>{item.description && <p className="whitespace-pre-wrap">{item.description}</p>}{item.rules && <p className="whitespace-pre-wrap">{item.rules}</p>}</section>}
    <p className="card text-sm text-muted">Only evidence selected by reporters is shown. This view does not open the private chat. {deleted ? "The source was deleted; submitted evidence remains available." : isMessage ? "Message reports do not grant access to the rest of the conversation." : suspended ? "This space is currently suspended and read-only." : "This space is currently active."}</p>
    <section className="space-y-3" aria-label="Submitted reports">{(reports ?? []).slice(0, 25).map((r, index) => {
      const evidence = z.array(Evidence).safeParse(r.evidence).data ?? []; const followups = requests.filter((q) => q.report_id === r.id);
      return <article key={r.id} className="card space-y-3" data-testid="platform-report"><p className="text-xs text-muted">Report {page * 25 + index + 1} · {r.category} · <LocalTime iso={r.created_at} full /></p><p className="whitespace-pre-wrap break-words text-sm">{r.reason}</p><EvidenceList messages={evidence} />{!evidence.length && <p className="text-xs text-muted">No specific messages attached. The allegation alone does not establish wrongdoing.</p>}
        {followups.map((q) => <section key={q.id} className="space-y-2 rounded-xl border border-border p-3"><p className="text-sm font-medium">{q.status === "open" ? "Waiting for reporter" : q.status === "answered" ? "Reporter supplied more information" : "Evidence request closed"}</p><p className="whitespace-pre-wrap text-sm">{q.question}</p><p className="text-xs text-muted">Requested <LocalTime iso={q.created_at} full /></p>{q.reply && <><p className="whitespace-pre-wrap break-words text-sm">{q.reply}</p>{q.answered_at && <p className="text-xs text-muted">Received <LocalTime iso={q.answered_at} full /></p>}<EvidenceList messages={q.evidence} /></>}</section>)}
        {item.status !== "closed" && !followups.some((q) => q.status === "open") && <RequestEvidenceForm report={r.id} revision={item.revision} />}
      </article>;
    })}</section>
    <div className="flex gap-3 text-sm">{page > 0 && <Link href={`/moderation/${id}?page=${page - 1}`} className="text-accent underline">Previous reports</Link>}{(reports?.length ?? 0) > 25 && <Link href={`/moderation/${id}?page=${page + 1}`} className="text-accent underline">More reports</Link>}</div>
    <ReviewCaseForm key={`${item.status}:${Boolean(suspended)}:${item.subject_user_id}`} id={id} revision={item.revision} closed={item.status === "closed"} suspended={Boolean(suspended)} message={isMessage} people={people} initialSubject={item.subject_user_id} />
    {sanctions?.map((s) => <section key={s.id} className="card space-y-2" aria-label="Account restriction decision"><h2 className="font-semibold">{s.subject_name} · {actionLabel(s.action)}</h2><p className="text-xs text-muted">Decision <LocalTime iso={s.created_at} full /></p>{s.expires_at && <p className="text-sm">Ends <LocalTime iso={s.expires_at} full /></p>}<p className="whitespace-pre-wrap text-sm">Justification: {s.justification}</p>{s.revoked_at ? <p className="text-sm">Lifted <LocalTime iso={s.revoked_at} full /> · {s.revoke_reason}</p> : <LiftRestrictionForm id={s.id} />}</section>)}
    {item.response && <p className="card whitespace-pre-wrap text-sm"><b>Shared decision:</b> {item.response}</p>}
    {(events?.length ?? 0) > 0 && <section className="card space-y-2"><h2 className="font-semibold">Latest review activity</h2>{events!.map((e) => <div key={e.id} className="border-t border-border pt-2 text-sm"><p className="text-xs text-muted">{actors?.find((a) => a.owner_id === e.actor_id)?.display_name ?? "Former reviewer"} · {e.action} · <LocalTime iso={e.created_at} /></p>{e.public_response && <p className="whitespace-pre-wrap">{e.public_response}</p>}{e.internal_note && <p className="mt-1 whitespace-pre-wrap rounded-lg bg-accent-soft p-2">Internal: {e.internal_note}</p>}</div>)}</section>}
  </div>;
}
