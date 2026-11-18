"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BusinessWays } from "@/components/BusinessWays";
import { summarise, type CompareCell, type Comparison } from "@/lib/compare/comparison";
import type { Way } from "@/lib/business/booking";
import { askTeamForComparisonAction } from "../../actions";

/** Puts text in this chat's message box (e.g. "Plan it here"), for the owner to finish. */
export const FILL_COMPOSER_EVENT = "agentme:fill-composer";

function CellText({ cell }: { cell?: CompareCell }) {
  if (!cell || cell.status === "asking") return <span className="animate-pulse text-muted">asking…</span>;
  if (cell.status === "timeout") return <span className="text-muted">didn&apos;t answer in time</span>;
  if (cell.status === "unreachable") return <span className="text-muted">couldn&apos;t be reached</span>;
  if (cell.status === "team_asked") return <span className="text-muted">asked the team…</span>;
  if (cell.status === "team_none") return <span className="text-muted">the team couldn&apos;t answer</span>;
  if (cell.status === "not_stated") return <span className="text-muted">not stated</span>;
  const mark = cell.yes === true ? "✓ " : cell.yes === false ? "✗ " : "";
  return (
    <>
      <span className="font-medium">{mark}{cell.text}</span>
      {cell.detail && !cell.text?.includes(cell.detail) && <span> · {cell.detail}</span>}
      {(cell.source || cell.reused) && (
        <span className="text-xs text-muted">
          {" "}({[cell.source ? (cell.status === "team_answered" ? "from its team" : cell.source) : "", cell.reused ? "answered earlier today" : ""].filter(Boolean).join(" · ")})
        </span>
      )}
    </>
  );
}

/**
 * The comparison card in My Agent: one block per business, one line per point, filled in as
 * answers arrive; "Ask the team" where its agent didn't know; the summary worked out in code.
 */
export function ComparisonCard({ messageId, comparison, actions }: { messageId: string; comparison: Comparison; actions: Record<string, Way[]> }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const waiting = comparison.cells.some((cell) => cell.status === "asking");
  const lines = waiting ? [] : summarise(comparison);
  const askTeam = (businessId: string, point: number) =>
    start(async () => {
      const result = await askTeamForComparisonAction(messageId, businessId, point);
      setNotice(result.error ? { ok: false, text: result.error } : { ok: true, text: result.notice ?? "Sent to the team." });
      if (!result.error) router.refresh();
    });
  return (
    <div className="mt-2 space-y-3 rounded-2xl border border-border bg-surface p-3 text-sm" data-testid="comparison-card">
      <p className="text-xs text-muted">{comparison.points.map((p) => p.label).join(" · ")}</p>
      <ul className="space-y-3">
        {comparison.businesses.map((business) => (
          <li key={business.id} className="rounded-xl bg-background/60 p-2.5" data-testid="comparison-business">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{business.name}</span>
              <button type="button" className="text-xs font-medium text-accent hover:underline" aria-expanded={open === business.id} onClick={() => setOpen((o) => (o === business.id ? null : business.id))}>
                {open === business.id ? "Close ▾" : "Open ▸"}
              </button>
            </div>
            <ul className="mt-1 space-y-0.5">
              {comparison.points.map((point, index) => {
                const cell = comparison.cells.find((c) => c.business_id === business.id && c.point === index);
                return (
                  <li key={index} className="flex flex-wrap items-baseline gap-x-2" data-testid="comparison-cell">
                    <span className="text-muted">{point.label.replace(/:\s*price$/i, "")}:</span>
                    <span><CellText cell={cell} /></span>
                    {cell?.status === "not_stated" && cell.handoff && (
                      <button type="button" className="text-xs font-medium text-accent underline" disabled={pending} onClick={() => askTeam(business.id, index)}>Ask the team</button>
                    )}
                  </li>
                );
              })}
            </ul>
            {open === business.id && (
              <div className="mt-2 space-y-2 border-t border-border pt-2">
                <BusinessWays ways={actions[business.id] ?? []} primary={false} agentId={business.id} source="recall" />
                {!(actions[business.id] ?? []).length && <p className="text-xs text-muted">{business.name} hasn&apos;t added booking or contact buttons.</p>}
                <button type="button" className="btn-ghost py-1 text-xs" onClick={() => window.dispatchEvent(new CustomEvent(FILL_COMPOSER_EVENT, { detail: `Organise a visit to @${business.handle} with ` }))}>
                  Plan it here
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {waiting ? (
        <p className="text-xs text-muted" role="status">Waiting for answers…</p>
      ) : (
        lines.length > 0 && <div className="space-y-0.5" data-testid="comparison-summary">{lines.map((line) => <p key={line} className="font-medium">{line}</p>)}</div>
      )}
      <p className="text-xs text-muted">Prices and details can change; check with the business.</p>
      {notice && <p className={`text-xs ${notice.ok ? "text-accent" : "text-danger"}`} role={notice.ok ? "status" : "alert"}>{notice.text}</p>}
    </div>
  );
}
