import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { OwnReport, statusLabel } from "@/lib/moderation/types";
import { LocalTime } from "@/components/LocalTime";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { EvidenceList } from "@/components/moderation/EvidenceList";
import { AnswerEvidenceForm } from "@/components/moderation/EvidenceFollowup";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAgent(); const { id } = await params; if (!z.uuid().safeParse(id).success) notFound();
  const { data } = await (await createClient()).rpc("own_platform_reports", { p_report: id }); const item = z.array(OwnReport).safeParse(data).data?.[0]; if (!item) notFound();
  return <div className="space-y-4"><RealtimeRefresh channel={`report-${id}`} tables={["platform_notifications", "platform_evidence_requests"]} /><Link href="/reports" className="text-sm text-accent">‹ Your reports</Link>
    <h1 className="text-xl font-semibold">Report about {item.title}</h1><p className="text-sm font-medium text-accent" data-testid="report-status">{statusLabel(item.status, item.outcome)}</p><p className="text-xs text-muted">Reference {id.slice(0, 8).toUpperCase()} · Submitted <LocalTime iso={item.created_at} full /></p>
    <p className="card whitespace-pre-wrap break-words text-sm">{item.reason}</p>
    {(item.description || item.rules) && <section className="card space-y-2 text-sm"><h2 className="font-medium">Space information when reported</h2>{item.description && <p className="whitespace-pre-wrap">{item.description}</p>}{item.rules && <p className="whitespace-pre-wrap">{item.rules}</p>}</section>}
    <section className="card space-y-3"><h2 className="font-semibold">Evidence you shared</h2>{item.evidence.length ? <EvidenceList messages={item.evidence} /> : <p className="text-sm text-muted">No specific messages attached.</p>}</section>
    {item.requests.map((request) => <section key={request.id} className="card space-y-3" data-testid="evidence-request"><h2 className="font-semibold">{request.status === "open" ? "AGENTME needs more evidence" : request.status === "answered" ? "Your additional information" : "Evidence request closed"}</h2><p className="whitespace-pre-wrap text-sm">{request.question}</p><p className="text-xs text-muted">Requested <LocalTime iso={request.created_at} full /></p>
      {request.status === "open" ? <AnswerEvidenceForm request={request.id} kind={item.target_kind} target={item.target_key} /> : request.reply && <><p className="whitespace-pre-wrap break-words text-sm">{request.reply}</p>{request.answered_at && <p className="text-xs text-muted">Sent <LocalTime iso={request.answered_at} full /></p>}<EvidenceList messages={request.evidence} /></>}
    </section>)}
    {item.response && <section className="card"><h2 className="mb-1 font-semibold">AGENTME&apos;s decision</h2><p className="whitespace-pre-wrap text-sm">{item.response}</p><p className="mt-2 text-xs text-muted"><LocalTime iso={item.updated_at} full /></p></section>}
    <p className="text-xs text-muted">Your report and identity are private from the reported person and local admins. AGENTME reviews only the information you chose to submit.</p>
  </div>;
}
