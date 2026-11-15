import Link from "next/link";
import { moderationAttention } from "@/lib/moderation/access";
import { openPlatformUpdate } from "@/app/(app)/platform-actions";
import { LocalTime } from "@/components/LocalTime";
import { ActionButton } from "@/components/ActionButton";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

export async function ModerationAttention() {
  const [data, own] = await Promise.all([moderationAttention(), (await createClient()).rpc("own_evidence_requests")]);
  const requests = z.array(z.object({ id: z.uuid(), report_id: z.uuid(), title: z.string(), question: z.string(), created_at: z.string() })).safeParse(own.data).data ?? [];
  if (!data.platform && !data.appeals && !data.local.length && !data.notifications.length && !requests.length) return null;
  return <section className="mb-4 space-y-3 rounded-2xl border border-accent bg-accent-soft/40 p-3" aria-label="Moderation updates" data-testid="moderation-attention">
    {data.platform > 0 && <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm"><b>Platform moderation</b> · {data.platform} {data.platform === 1 ? "case needs" : "cases need"} review</p><Link href="/moderation" className="btn-primary">Review reports</Link></div>}
    {data.appeals > 0 && <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm"><b>Account appeals</b> · {data.appeals} {data.appeals === 1 ? "appeal needs" : "appeals need"} an independent review</p><Link href="/moderation/appeals" className="btn-primary">Review account appeals</Link></div>}
    {requests.map((request) => <div key={request.id} className="space-y-2 border-t border-border pt-2 text-sm" data-testid="evidence-attention"><p><b>AGENTME needs more evidence</b> · {request.title}</p><p>{request.question}</p><p className="text-xs text-muted"><LocalTime iso={request.created_at} full /></p><Link className="btn-primary" href={`/reports/${request.report_id}`}>Reply to request</Link></div>)}
    {data.local.map((item) => <div key={`${item.kind}:${item.id}`} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span><b>{item.title ?? "Group"}</b> · {item.total} reported {item.total === 1 ? "message" : "messages"}</span><Link href={item.kind === "group" ? `/groups/${item.id}#reported-messages` : `/communities/${item.id}#moderation`} className="btn-ghost">Review messages</Link></div>)}
    {data.notifications.map((notice) => <div key={notice.id} className="space-y-2 border-t border-border pt-2 text-sm" data-testid="platform-notification"><p>{notice.text}</p><p className="text-xs text-muted"><LocalTime iso={notice.created_at} /></p><div className="flex gap-2"><ActionButton action={openPlatformUpdate.bind(null, notice.id, true)} label="View update" /><ActionButton action={openPlatformUpdate.bind(null, notice.id, false)} label="Dismiss" /></div></div>)}
  </section>;
}
