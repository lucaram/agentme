import type { z } from "zod";
import { OwnSanction, actionLabel } from "@/lib/moderation/types";
import { LocalTime } from "@/components/LocalTime";
import { AccountAppealForm } from "./AccountAppealForms";

export function AccountDecisionCard({ sanction }: { sanction: z.infer<typeof OwnSanction> }) {
  const active = sanction.restriction_status === "active";
  const status = active ? "Active" : sanction.restriction_status === "lifted" ? "Lifted" : "Expired";
  const appeal = sanction.appeal;
  return <details id={`decision-${sanction.id}`} className="group scroll-mt-8 overflow-hidden rounded-2xl border border-border bg-surface open:border-accent/40" data-testid="own-account-decision">
    <summary className="flex cursor-pointer items-start gap-3 p-4 sm:p-5"><span aria-hidden className={`mt-0.5 text-lg ${active ? "text-danger" : "text-muted"}`}>◷</span><span className="min-w-0 flex-1 space-y-2"><span className="block font-semibold">{actionLabel(sanction.action)}</span><span className="block text-xs text-muted">Decision <LocalTime iso={sanction.created_at} full /></span><span className="flex flex-wrap gap-2"><span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${active ? "border-danger/30 bg-danger/10 text-danger" : sanction.restriction_status === "lifted" ? "border-accent/30 bg-accent-soft text-accent" : "border-border text-muted"}`}>{status}</span>{appeal && <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">{appeal.status === "open" ? "Appeal under review" : appeal.status === "accepted" ? "Appeal accepted" : "Appeal rejected"}</span>}</span></span><span aria-hidden className="text-muted transition-transform group-open:rotate-90">›</span></summary>
    <div className="space-y-4 border-t border-border p-4 sm:p-5">
      <div><h3 className="text-xs font-medium text-muted">Justification</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm">{sanction.justification}</p></div>
      {sanction.expires_at && <p className="text-sm"><span className="text-muted">Restriction ends: </span><LocalTime iso={sanction.expires_at} full /></p>}
      {sanction.revoked_at ? <div className="rounded-xl bg-accent-soft/30 p-3 text-sm"><p>Lifted <LocalTime iso={sanction.revoked_at} full /></p>{sanction.revoke_reason && <p className="mt-1 whitespace-pre-wrap break-words text-muted">{sanction.revoke_reason}</p>}</div> : sanction.restriction_status === "expired" && <p className="text-sm text-muted">This suspension has expired.</p>}
      <div className="border-t border-border pt-4">{appeal ? <section className="space-y-3" aria-label="Your appeal"><h3 className="text-sm font-semibold">{appeal.status === "open" ? "Appeal submitted — under review" : appeal.status === "accepted" ? "Appeal accepted" : "Appeal rejected"}</h3>{appeal.status === "open" && <p className="hint">Awaiting an independent reviewer.</p>}<div><p className="text-xs text-muted">Your explanation</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{appeal.reason}</p></div><p className="text-xs text-muted">Submitted <LocalTime iso={appeal.created_at} full /></p>{appeal.response && <div><p className="text-xs text-muted">Decision justification</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{appeal.response}</p></div>}{appeal.reviewed_at && <p className="text-xs text-muted">Reviewed <LocalTime iso={appeal.reviewed_at} full /></p>}</section> : <AccountAppealForm id={sanction.id} />}</div>
    </div>
  </details>;
}
