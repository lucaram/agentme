"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChatDialog } from "@/components/chat/ChatDialog";
import {
  COMMON_TAGS, PRICE_TYPES, PRICE_TYPE_LABEL, TAG_ICON, MAX_TAGS, durationText, formatPrice, groupItems, priceNote, priceText,
  type Item, type Kind, type PriceRow, type PriceType,
} from "@/lib/business/offerings-shared";
import { deleteItemAction, hideItemAction, rereadOfferingsAction, saveItemAction } from "./actions";

const NO_CATEGORY = "Other";
type Draft = {
  group_id: string | null; kind: Kind; category: string; item: string; description: string; tags: string[]; price_type: PriceType; currency: string;
  duration: string; needs_booking: boolean; options: { id: string | null; label: string; price: string }[];
};
const newDraft = (kind: Kind, currency: string): Draft => ({ group_id: null, kind, category: "", item: "", description: "", tags: [], price_type: "fixed", currency, duration: "", needs_booking: false, options: [{ id: null, label: "", price: "" }] });
const draftOf = (i: Item): Draft => ({
  group_id: i.group_id, kind: i.kind, category: i.category ?? "", item: i.item, description: i.description ?? "", tags: i.tags, price_type: i.price_type, currency: i.currency,
  duration: i.duration_minutes ? String(i.duration_minutes) : "", needs_booking: i.needs_booking,
  options: i.options.filter((o) => !o.hidden || i.hidden).map((o) => ({ id: o.id, label: o.label ?? "", price: o.price === null ? "" : String(o.price) })),
});

function Tag({ tag }: { tag: string }) {
  return <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px]">{TAG_ICON[tag] ? `${TAG_ICON[tag]} ` : ""}{tag}</span>;
}

/**
 * Products and services, as read from your website and documents: by category, one item with its options
 * ("10-inch £7.50 · 12-inch £8.50"), tags, and for services how they're priced, how long they take and
 * whether they need booking. Tap one to change anything.
 */
export function PricesEditor({ prices, hasSources }: { prices: PriceRow[]; hasSources: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const items = useMemo(() => groupItems(prices), [prices]);
  const counts = { product: items.filter((i) => i.kind === "product").length, service: items.filter((i) => i.kind === "service").length };
  const [tab, setTab] = useState<Kind>(counts.product || !counts.service ? "product" : "service");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currency = items[0]?.currency ?? "GBP";

  const inTab = items.filter((i) => i.kind === tab);
  const categories = [...new Set(inTab.map((i) => i.category ?? NO_CATEGORY))];
  const q = query.trim().toLowerCase();
  const shown = inTab.filter((i) => (!category || (i.category ?? NO_CATEGORY) === category) && (!q || `${i.item} ${i.category ?? ""} ${i.tags.join(" ")} ${i.options.map((o) => o.label ?? "").join(" ")}`.toLowerCase().includes(q)));
  const sections = categories.map((c) => [c, shown.filter((i) => (i.category ?? NO_CATEGORY) === c)] as const).filter(([, list]) => list.length);
  const allCategories = [...new Set(items.filter((i) => i.kind === (draft?.kind ?? tab)).flatMap((i) => (i.category ? [i.category] : [])))];

  const act = (fn: () => Promise<{ error?: string }>, ok?: string, close = false) =>
    start(async () => {
      const result = await fn();
      if (result.error) { setError(result.error); setMessage({ ok: false, text: result.error }); return; }
      setError(null);
      setMessage(ok ? { ok: true, text: ok } : null);
      if (close) setDraft(null);
      router.refresh();
    });

  const save = (d: Draft) => act(() => saveItemAction({
    group_id: d.group_id, kind: d.kind, category: d.category.trim() || null, item: d.item.trim(), description: d.description.trim() || null, tags: d.tags,
    price_type: d.price_type, currency: d.currency, duration_minutes: d.kind === "service" && d.duration.trim() ? Math.round(Number(d.duration)) || null : null, needs_booking: d.needs_booking,
    options: d.options.map((o) => ({ id: o.id, label: o.label.trim() || null, price: o.price.trim() === "" ? null : Number(o.price.replace(",", ".")) })),
  }), undefined, true);

  const editing = draft ? items.find((i) => i.group_id === draft.group_id) : undefined;
  const priced = draft ? draft.price_type !== "free" && draft.price_type !== "on_request" : true;

  return (
    <div className="space-y-4" data-testid="prices">
      <div role="tablist" aria-label="Products and services" className="flex gap-1 border-b border-border">
        {(["product", "service"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} data-testid={`${k}s-tab`} onClick={() => { setTab(k); setCategory(null); }}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${tab === k ? "border-accent font-semibold" : "border-transparent text-muted hover:text-foreground"}`}>
            {k === "product" ? "Products" : "Services"}
            <span className="rounded-full bg-accent-soft px-1.5 text-[11px] text-muted">{counts[k]}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {inTab.length > 6 && <input className="input w-auto min-w-0 flex-1 py-1 text-sm" placeholder={`Search ${tab === "product" ? "products" : "services"}`} aria-label="Search" value={query} onChange={(e) => setQuery(e.target.value)} />}
        {hasSources && <button type="button" className="btn-ghost ml-auto py-1 text-xs" disabled={pending} onClick={() => act(rereadOfferingsAction, "Looking again. This can take a minute.")}>↻ Look again</button>}
      </div>
      {categories.length > 1 && (
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto" aria-label="Categories">
          {[null, ...categories].map((c) => (
            <button key={c ?? "all"} type="button" aria-pressed={category === c} onClick={() => setCategory(c)}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs ${category === c ? "border-accent bg-accent-soft font-medium" : "border-border text-muted hover:bg-accent-soft"}`}>
              {c ?? "All"}
            </button>
          ))}
        </div>
      )}

      {!inTab.length && (
        <p className="text-sm text-muted">
          {tab === "product" ? "No products yet." : "No services yet: a haircut, a repair, room hire, a lesson…"}{" "}
          {tab === "product" && <>{hasSources ? "If your menu or price list is a document or photo, add it in " : "Add your menu or price list in "}<Link href="/business#website-documents" className="text-accent underline">Website &amp; documents</Link>, or add one below.</>}
        </p>
      )}

      {sections.map(([name, list]) => (
        <details key={name} open className="card p-0" data-testid="price-category">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 [&::-webkit-details-marker]:hidden">
            <span className="font-semibold">{name}</span>
            <span className="text-xs text-muted">{list.length}</span>
          </summary>
          <ul className="divide-y divide-border border-t border-border">
            {list.map((i) => {
              const changed = i.options.find((o) => o.corrected && o.found_price !== null && o.price !== null && o.found_price !== o.price);
              return (
                <li key={i.group_id}>
                  <button type="button" className={`flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-accent-soft ${i.hidden ? "opacity-50" : ""}`} onClick={() => { setError(null); setDraft(draftOf(i)); }} data-testid="price-item">
                    <span className="min-w-0 flex-1 space-y-0.5">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{i.item}</span>
                        {i.tags.map((t) => <Tag key={t} tag={t} />)}
                      </span>
                      <span className="block text-sm">
                        {i.options.filter((o) => !o.hidden || i.hidden).map((o) => `${o.label ? `${o.label} ` : ""}${priceText(o.price, i.price_type, i.currency)}`).join(" · ")}
                        {i.kind === "service" && i.duration_minutes && <span className="text-muted"> · {durationText(i.duration_minutes)}</span>}
                        {i.kind === "service" && i.needs_booking && <span className="text-muted"> · booking needed</span>}
                      </span>
                      {i.description && <span className="block truncate text-xs text-muted">{i.description}</span>}
                      <span className="block text-[11px] text-muted">
                        {i.hidden ? "Hidden from your agent · " : ""}
                        {changed ? `Changed by you · the document says ${formatPrice(changed.found_price!, i.currency)}` : i.added ? "Added by you" : i.corrected ? "Changed by you" : i.source_label ?? ""}
                      </span>
                    </span>
                    <span className="mt-1 text-accent" aria-hidden>›</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </details>
      ))}

      <button type="button" className="text-sm font-medium text-accent hover:underline" onClick={() => { setError(null); setDraft({ ...newDraft(tab, currency), category: category && category !== NO_CATEGORY ? category : "" }); }}>
        ＋ Add a {tab}
      </button>
      {message && !draft && <p className={`text-sm ${message.ok ? "text-accent" : "text-danger"}`} role={message.ok ? "status" : "alert"}>{message.text}</p>}

      {draft && (
        <ChatDialog label={draft.group_id ? `Edit ${draft.item}` : `Add a ${draft.kind}`} onClose={() => setDraft(null)} presentation="sheet">
          <form className="space-y-4 p-5" onSubmit={(e) => { e.preventDefault(); save(draft); }} data-testid="item-editor">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">{draft.group_id ? "Edit" : "Add"}</h2>
              <button type="button" className="btn-ghost px-2" aria-label="Close" onClick={() => setDraft(null)}>✕</button>
            </div>
            <div className="flex gap-2" role="radiogroup" aria-label="Product or service">
              {(["product", "service"] as const).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={draft.kind === k} onClick={() => setDraft({ ...draft, kind: k })}
                  className={`rounded-full border px-3 py-1 text-sm ${draft.kind === k ? "border-accent bg-accent-soft font-medium" : "border-border"}`}>{k === "product" ? "Product" : "Service"}</button>
              ))}
            </div>
            <label className="block space-y-1 text-sm"><span className="label">Name</span>
              <input className="input" required maxLength={120} placeholder={draft.kind === "product" ? "e.g. Margherita pizza" : "e.g. Men's haircut"} value={draft.item} onChange={(e) => setDraft({ ...draft, item: e.target.value })} />
            </label>
            <label className="block space-y-1 text-sm"><span className="label">Category</span>
              <input className="input" list="price-categories" maxLength={60} placeholder={draft.kind === "product" ? "e.g. Pizza" : "e.g. Cuts"} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
              <datalist id="price-categories">{allCategories.map((c) => <option key={c} value={c} />)}</datalist>
            </label>

            <fieldset className="space-y-2">
              <legend className="label">Price</legend>
              <div className="flex flex-wrap gap-2">
                <select className="input w-auto" aria-label="How it's priced" value={draft.price_type} onChange={(e) => setDraft({ ...draft, price_type: e.target.value as PriceType })}>
                  {PRICE_TYPES.map((t) => <option key={t} value={t}>{PRICE_TYPE_LABEL[t]}</option>)}
                </select>
                {priced && (
                  <select className="input w-auto" aria-label="Currency" value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })}>
                    {["GBP", "EUR", "USD"].map((c) => <option key={c}>{c}</option>)}
                  </select>
                )}
              </div>
              {draft.options.map((o, idx) => (
                <div key={idx} className="flex items-center gap-2" data-testid="item-option">
                  <input className="input min-w-0 flex-1" maxLength={60} aria-label={`Option ${idx + 1}`} placeholder={draft.options.length > 1 ? "Size or option, e.g. 12-inch" : "Size or option (optional)"} value={o.label}
                    onChange={(e) => setDraft({ ...draft, options: draft.options.map((x, j) => (j === idx ? { ...x, label: e.target.value } : x)) })} />
                  {priced && (
                    <input className="input w-24" inputMode="decimal" aria-label={`Price for option ${idx + 1}`} placeholder="8.50" required value={o.price}
                      onChange={(e) => setDraft({ ...draft, options: draft.options.map((x, j) => (j === idx ? { ...x, price: e.target.value } : x)) })} />
                  )}
                  {draft.options.length > 1 && <button type="button" className="btn-ghost px-2" aria-label={`Remove option ${idx + 1}`} onClick={() => setDraft({ ...draft, options: draft.options.filter((_, j) => j !== idx) })}>✕</button>}
                </div>
              ))}
              {draft.options.length < 12 && <button type="button" className="text-xs font-medium text-accent hover:underline" onClick={() => setDraft({ ...draft, options: [...draft.options, { id: null, label: "", price: "" }] })}>＋ Add an option (size, portion…)</button>}
            </fieldset>

            {draft.kind === "service" && (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-2"><span className="label">Takes</span>
                  <input className="input w-20" inputMode="numeric" aria-label="Duration in minutes" placeholder="45" value={draft.duration} onChange={(e) => setDraft({ ...draft, duration: e.target.value.replace(/[^\d]/g, "") })} />
                  <span className="text-muted">min</span>
                </label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={draft.needs_booking} onChange={(e) => setDraft({ ...draft, needs_booking: e.target.checked })} />Needs booking</label>
              </div>
            )}

            <fieldset className="space-y-2">
              <legend className="label">Tags</legend>
              <div className="flex flex-wrap gap-1.5">
                {[...COMMON_TAGS, ...draft.tags.filter((t) => !(COMMON_TAGS as readonly string[]).includes(t))].map((t) => {
                  const on = draft.tags.includes(t);
                  return (
                    <button key={t} type="button" aria-pressed={on} disabled={!on && draft.tags.length >= MAX_TAGS}
                      onClick={() => setDraft({ ...draft, tags: on ? draft.tags.filter((x) => x !== t) : [...draft.tags, t] })}
                      className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-accent bg-accent-soft font-medium" : "border-border text-muted"}`}>
                      {TAG_ICON[t] ? `${TAG_ICON[t]} ` : ""}{t}
                    </button>
                  );
                })}
                <input className="input w-36 py-1 text-xs" maxLength={30} placeholder="＋ Your own tag" aria-label="Your own tag"
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    const t = e.currentTarget.value.trim();
                    if (t && !draft.tags.some((x) => x.toLowerCase() === t.toLowerCase()) && draft.tags.length < MAX_TAGS) setDraft({ ...draft, tags: [...draft.tags, t] });
                    e.currentTarget.value = "";
                  }} />
              </div>
            </fieldset>
            <label className="block space-y-1 text-sm"><span className="label">Description (optional)</span>
              <input className="input" maxLength={200} placeholder={draft.kind === "product" ? "e.g. Tomato, mozzarella, basil" : "e.g. Wash, cut and style"} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </label>

            {editing && (
              <p className="text-xs text-muted">
                {editing.added ? "Added by you." : `Read from ${editing.source_label ?? "your documents"} · ${priceNote({ corrected: false, added: false, source_label: editing.source_label, read_at: editing.read_at }).replace(/^from [^,]+, /, "")}. What you change here wins over the document.`}
              </p>
            )}
            {error && <p className="text-sm text-danger" role="alert">{error}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
              <button type="button" className="btn-ghost" onClick={() => setDraft(null)}>Cancel</button>
              {editing && (
                <span className="ml-auto flex gap-2">
                  <button type="button" className="btn-ghost" disabled={pending} onClick={() => act(() => hideItemAction(editing.group_id, !editing.hidden), undefined, true)}>{editing.hidden ? "Show" : "Hide"}</button>
                  {editing.added && <button type="button" className="btn-ghost text-danger" disabled={pending} onClick={() => act(() => deleteItemAction(editing.group_id), undefined, true)}>Delete</button>}
                </span>
              )}
            </div>
          </form>
        </ChatDialog>
      )}
    </div>
  );
}
