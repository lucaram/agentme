"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatPrice, priceNote, type PriceRow } from "@/lib/business/offerings-shared";
import { addPriceAction, correctPriceAction, hidePriceAction, removePriceAction, rereadOfferingsAction } from "./actions";

const ADDED = "Added by you";

/** Prices read from your website and documents: correct, hide, add your own. */
export function PricesEditor({ prices, hasSources }: { prices: PriceRow[]; hasSources: boolean }) {
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
    const map = new Map<string, PriceRow[]>();
    for (const p of prices.filter((p) => !q || `${p.item} ${p.variant ?? ""}`.toLowerCase().includes(q))) {
      const key = p.added || !p.source_label ? ADDED : p.source_label;
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return [...map.entries()].sort(([a], [b]) => (a === ADDED ? 1 : b === ADDED ? -1 : a.localeCompare(b)));
  }, [prices, query]);

  return (
    <div className="space-y-3" data-testid="prices">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {prices.length > 10 ? <input className="input w-auto py-1 text-sm" placeholder="Search prices" aria-label="Search prices" value={query} onChange={(e) => setQuery(e.target.value)} /> : <span />}
        {hasSources && <button type="button" className="btn-ghost py-1 text-xs" disabled={pending} onClick={() => act(rereadOfferingsAction, "Looking again. This can take a minute.")}>↻ Look again</button>}
      </div>
      {!prices.length && (
        <p className="text-sm text-muted">
          {hasSources ? "No prices found yet. If your menu or price list is a document or photo, add it in " : "Add your menu or price list in "}
          <Link href="/business#website-documents" className="text-accent underline">Website &amp; documents</Link>, or add a price below.
        </p>
      )}
      {groups.map(([label, rows]) => (
        <div key={label} className="card p-0" data-testid="price-group">
          <p className="border-b border-border px-4 py-2 text-xs text-muted">
            <span className="font-medium text-foreground">{label}</span> · {rows.length} {rows.length === 1 ? "price" : "prices"}
            {label !== ADDED && rows[0]?.read_at && <> · {priceNote({ ...rows[0], corrected: false, added: false }).replace(/^from [^,]+, /, "")}</>}
          </p>
          <ul className="divide-y divide-border">
            {rows.map((p) => (
              <li key={p.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm ${p.hidden ? "opacity-50" : ""}`} data-testid="price-row">
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
          className="card flex flex-wrap items-end gap-2"
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
      {message && <p className={`text-sm ${message.ok ? "text-accent" : "text-danger"}`} role={message.ok ? "status" : "alert"}>{message.text}</p>}
    </div>
  );
}
