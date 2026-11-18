"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FACILITIES, facilityName, facilityNote, isCustomFacility, type FacilityRow } from "@/lib/business/offerings-shared";
import { removeFacilityAction, rereadOfferingsAction, saveFacilityAction } from "./actions";

type Draft = { key: string | null; label: string; status: "yes" | "no"; note: string };

/**
 * Your facilities: what was read from your website and documents (confirm it with a tap), the common
 * ones to add, and your own ("Live music"). Edit or remove any of them.
 */
export function FacilitiesEditor({ facilities, hasSources }: { facilities: FacilityRow[]; hasSources: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const shown = facilities.filter((f) => !f.hidden).sort((a, b) => facilityName(a).label.localeCompare(facilityName(b).label));
  const addable = FACILITIES.filter((f) => !shown.some((s) => s.key === f.key));
  const act = (fn: () => Promise<{ error?: string }>, ok?: string) =>
    start(async () => {
      const result = await fn();
      setMessage(result.error ? { ok: false, text: result.error } : ok ? { ok: true, text: ok } : null);
      if (!result.error) { setDraft(null); router.refresh(); }
    });
  const save = (d: Draft) => act(() => saveFacilityAction({ key: d.key, label: d.label.trim() || null, status: d.status, note: d.note.trim() || null }));

  const editor = (d: Draft, isNew: boolean) => (
    <form className="space-y-2 px-4 py-3" onSubmit={(e) => { e.preventDefault(); save(d); }} data-testid="facility-editor">
      {(!d.key || isCustomFacility(d.key)) && (
        <input className="input" placeholder="Name, e.g. Live music" aria-label="Facility name" maxLength={60} value={d.label} onChange={(e) => setDraft({ ...d, label: e.target.value })} required autoFocus={isNew} />
      )}
      <div className="flex gap-2" role="radiogroup" aria-label="Do you have it?">
        {(["yes", "no"] as const).map((s) => (
          <button key={s} type="button" role="radio" aria-checked={d.status === s} className={`rounded-full border px-3 py-1 text-sm ${d.status === s ? "border-accent bg-accent-soft font-medium" : "border-border"}`} onClick={() => setDraft({ ...d, status: s })}>
            {s === "yes" ? "✓ Yes" : "✗ No"}
          </button>
        ))}
      </div>
      <input className="input" placeholder="Details (optional), e.g. free car park for 20 cars" aria-label="Details" maxLength={300} value={d.note} onChange={(e) => setDraft({ ...d, note: e.target.value })} />
      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending}>Save</button>
        <button type="button" className="btn-ghost" onClick={() => setDraft(null)}>Cancel</button>
      </div>
    </form>
  );

  return (
    <div className="space-y-4" data-testid="facilities">
      {hasSources && (
        <div className="flex justify-end">
          <button type="button" className="btn-ghost py-1 text-xs" disabled={pending} onClick={() => act(rereadOfferingsAction, "Looking again. This can take a minute.")}>↻ Look again</button>
        </div>
      )}
      {shown.length ? (
        <ul className="card divide-y divide-border p-0">
          {shown.map((f) => {
            const { label, icon } = facilityName(f);
            return (
              <li key={f.key} data-testid={`facility-${isCustomFacility(f.key) ? "custom" : f.key}`}>
                {draft?.key === f.key ? editor(draft, false) : (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                    <span aria-hidden>{icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{label}</span>
                      <span className="block text-xs text-muted">
                        <span className={f.status === "yes" ? "text-accent" : "text-foreground"}>{f.status === "yes" ? "✓ Yes" : "✗ No"}</span>
                        {f.evidence && <> · {f.confirmed && !f.source_label ? f.evidence : `“${f.evidence}”`}</>}
                        {" "}· {f.confirmed ? "confirmed by you" : facilityNote(f)}
                      </span>
                    </span>
                    <span className="flex gap-1">
                      {!f.confirmed && <button type="button" className="btn-primary px-2 py-1 text-xs" disabled={pending} onClick={() => save({ key: f.key, label: f.label ?? "", status: f.status as "yes" | "no", note: "" })}>✓ Correct</button>}
                      <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setDraft({ key: f.key, label: f.label ?? "", status: f.status as "yes" | "no", note: f.confirmed && !f.source_label ? f.evidence ?? "" : "" })}>Edit</button>
                      <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={pending} onClick={() => act(() => removeFacilityAction(f.key))}>Remove</button>
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted">No facilities yet. Add the ones customers ask about.</p>
      )}

      <section className="space-y-2" aria-label="Add a facility">
        <h2 className="text-sm font-medium">Add a facility</h2>
        {draft && !shown.some((f) => f.key === draft.key) ? (
          <div className="card p-0">
            {draft.key && !isCustomFacility(draft.key) && <p className="px-4 pt-3 text-sm font-medium">{facilityName({ key: draft.key, label: null }).icon} {facilityName({ key: draft.key, label: null }).label}</p>}
            {editor(draft, true)}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {addable.map((f) => (
              <button key={f.key} type="button" className="rounded-full border border-border bg-surface px-3 py-1 text-xs hover:bg-accent-soft" onClick={() => setDraft({ key: f.key, label: "", status: "yes", note: "" })}>
                <span aria-hidden>{f.icon}</span> {f.label}
              </button>
            ))}
            <button type="button" className="rounded-full border border-dashed border-border px-3 py-1 text-xs text-accent hover:bg-accent-soft" onClick={() => setDraft({ key: null, label: "", status: "yes", note: "" })}>＋ Your own</button>
          </div>
        )}
      </section>
      {message && <p className={`text-sm ${message.ok ? "text-accent" : "text-danger"}`} role={message.ok ? "status" : "alert"}>{message.text}</p>}
    </div>
  );
}
