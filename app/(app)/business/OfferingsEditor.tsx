"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SectionLink } from "@/components/SectionLink";
import { FACILITIES, formatPrice, priceNote, facilityNote, type FacilityRow, type PriceRow } from "@/lib/business/offerings-shared";
import { addPriceAction, correctPriceAction, hidePriceAction, removePriceAction, rereadOfferingsAction, setFacilityAction } from "./actions";

const ADDED = "Added by you";

/**
 * "Prices & facilities": what your agent read in your website and documents, for you to check.
 * Correct or hide a price, add one no document mentions, and confirm facilities with a tap.
 */
export function OfferingsEditor({ prices, facilities, hasSources }: { prices: PriceRow[]; facilities: FacilityRow[]; hasSources: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [item, setItem] = useState({ item: "", variant: "", price: "", currency: "GBP" });
  const act = (fn: () => Promise<{ error?: string }>, ok?: string) =>
    start(async () => {
      const result = await fn();
      setMessage(result.error ? { ok: false, text: result.error } : ok ? { ok: true, text: ok } : null);
      if (!result.error) router.refresh();
    });

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = prices.filter((p) => !q || `${p.item} ${p.variant ?? ""}`.toLowerCase().includes(q));
    const map = new Map<string, PriceRow[]>();
    for (const p of shown) map.set(p.added || !p.source_label ? ADDED : p.source_label, [...(map.get(p.added || !p.source_label ? ADDED : p.source_label) ?? []), p]);
    return [...map.entries()].sort(([a], [b]) => (a === ADDED ? 1 : b === ADDED ? -1 : a.localeCompare(b)));
  }, [prices, query]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm" data-testid="offerings-explained">
          <b>Read from your <SectionLink id="website-documents" className="text-accent underline">website and documents</SectionLink>.</b> Check them and correct anything wrong. Your agent uses them to answer customers, including when they compare you with other businesses.
        </p>
        {hasSources && <button type="button" className="btn-ghost shrink-0 py-1 text-xs" disabled={pending} onClick={() => act(rereadOfferingsAction, "Looking again. This can take a minute.")}>↻ Look again</button>}
      </div>

      <section aria-label="Prices" className="space-y-3" data-testid="prices">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">Prices <span className="text-xs font-normal text-muted">{prices.filter((p) => !p.hidden).length}</span></h3>
          {prices.length > 10 && <input className="input w-auto py-1 text-sm" placeholder="Search prices" aria-label="Search prices" value={query} onChange={(e) => setQuery(e.target.value)} />}
        </div>
        {!prices.length && (
          <p className="text-sm text-muted">
            {hasSources ? "No prices found yet. If your menu or price list is a document or photo, add it in " : "Add your menu or price list in "}
            <SectionLink id="website-documents" className="text-accent underline">Website &amp; documents</SectionLink>, or add a price below.
          </p>
        )}
        {groups.map(([label, rows]) => (
          <div key={label} className="rounded-xl border border-border" data-testid="price-group">
            <p className="border-b border-border px-3 py-2 text-xs text-muted">
              <span className="font-medium text-foreground">{label}</span> · {rows.length} {rows.length === 1 ? "price" : "prices"}
              {label !== ADDED && rows[0]?.read_at && <> · {priceNote({ ...rows[0], corrected: false, added: false }).replace(/^from [^,]+, /, "")}</>}
            </p>
            <ul className="divide-y divide-border">
              {rows.map((p) => (
                <li key={p.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm ${p.hidden ? "opacity-50" : ""}`} data-testid="price-row">
                  <span className="min-w-0 flex-1">
                    {p.item}{p.variant && <span className="text-muted"> · {p.variant}</span>}
                    {p.corrected && p.found_price !== null && Number(p.found_price) !== Number(p.price) && <span className="block text-xs text-muted">Corrected · the document says {formatPrice(p.found_price, p.currency)}</span>}
                    {p.hidden && <span className="block text-xs text-muted">Hidden from your agent</span>}
                  </span>
                  {editing === p.id ? (
                    <span className="flex items-center gap-1">
                      <input className="input w-24 py-1 text-sm" inputMode="decimal" aria-label={`New price for ${p.item}`} value={draft} onChange={(e) => setDraft(e.target.value)} />
                      <button type="button" className="btn-primary py-1 text-xs" disabled={pending} onClick={() => act(async () => { const r = await correctPriceAction(p.id, Number(draft.replace(",", "."))); if (!r.error) setEditing(null); return r; })}>Save</button>
                      <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setEditing(null)}>Cancel</button>
                    </span>
                  ) : (
                    <>
                      <span className="font-medium tabular-nums">{formatPrice(p.price, p.currency)}</span>
                      <span className="flex gap-1">
                        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => { setEditing(p.id); setDraft(String(p.price)); }}>Edit</button>
                        {p.added ? (
                          <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={pending} onClick={() => act(() => removePriceAction(p.id))}>Remove</button>
                        ) : (
                          <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={pending} onClick={() => act(() => hidePriceAction(p.id, !p.hidden))}>{p.hidden ? "Show" : "Hide"}</button>
                        )}
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {adding ? (
          <form
            className="flex flex-wrap items-end gap-2 rounded-xl border border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => { const r = await addPriceAction({ item: item.item, variant: item.variant || null, price: Number(item.price.replace(",", ".")), currency: item.currency }); if (!r.error) { setAdding(false); setItem({ item: "", variant: "", price: "", currency: item.currency }); } return r; });
            }}
          >
            <input className="input min-w-40 flex-1" placeholder="Item, e.g. Margherita pizza" aria-label="Item" maxLength={120} value={item.item} onChange={(e) => setItem({ ...item, item: e.target.value })} required />
            <input className="input w-32" placeholder="Size (optional)" aria-label="Size or option" maxLength={60} value={item.variant} onChange={(e) => setItem({ ...item, variant: e.target.value })} />
            <input className="input w-24" placeholder="8.50" inputMode="decimal" aria-label="Price" value={item.price} onChange={(e) => setItem({ ...item, price: e.target.value })} required />
            <select className="input w-auto" aria-label="Currency" value={item.currency} onChange={(e) => setItem({ ...item, currency: e.target.value })}>
              <option>GBP</option><option>EUR</option><option>USD</option>
            </select>
            <button className="btn-primary" disabled={pending}>Add</button>
            <button type="button" className="btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
          </form>
        ) : (
          <button type="button" className="text-sm font-medium text-accent hover:underline" onClick={() => setAdding(true)}>＋ Add a price</button>
        )}
      </section>

      <section aria-label="Facilities" className="space-y-2" data-testid="facilities">
        <h3 className="font-medium">Facilities</h3>
        <ul className="divide-y divide-border rounded-xl border border-border">
          {FACILITIES.map((f) => {
            const row = facilities.find((x) => x.key === f.key);
            return (
              <li key={f.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm" data-testid={`facility-${f.key}`}>
                <span aria-hidden>{f.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{f.label}</span>
                  {row ? (
                    <span className="block text-xs text-muted">
                      <span className={row.status === "yes" ? "text-accent" : "text-foreground"}>{row.status === "yes" ? "✓ Yes" : "✗ No"}</span>
                      {row.evidence && <> · “{row.evidence}”</>}
                      {" "}· {row.confirmed ? "confirmed by you" : facilityNote(row)}
                    </span>
                  ) : (
                    <span className="block text-xs text-muted">Not mentioned</span>
                  )}
                </span>
                <span className="flex gap-1">
                  {row && !row.confirmed && <button type="button" className="btn-primary px-2 py-1 text-xs" disabled={pending} onClick={() => act(() => setFacilityAction(f.key, row.status as "yes" | "no"))}>✓ Correct</button>}
                  {row ? (
                    <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={pending} onClick={() => act(() => setFacilityAction(f.key, row.status === "yes" ? "no" : "yes"))}>Change to {row.status === "yes" ? "No" : "Yes"}</button>
                  ) : (
                    <>
                      <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={pending} onClick={() => act(() => setFacilityAction(f.key, "yes"))}>Yes</button>
                      <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={pending} onClick={() => act(() => setFacilityAction(f.key, "no"))}>No</button>
                    </>
                  )}
                  {row?.confirmed && <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={pending} onClick={() => act(() => setFacilityAction(f.key, "unknown"))}>Clear</button>}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      {message && <p className={`text-sm ${message.ok ? "text-accent" : "text-danger"}`} role={message.ok ? "status" : "alert"}>{message.text}</p>}
    </div>
  );
}
