"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LocalTime } from "@/components/LocalTime";
import { Thinking } from "@/components/Thinking";
import type { PriceSource } from "@/lib/business/offerings-shared";
import { addSourceAction, rereadOfferingsAction } from "./actions";

const items = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;

/**
 * Top of Prices: where the prices come from (each document, and the website's pages together), reading
 * as it happens, and adding a menu right here. The same documents as in Website & links.
 * On Facilities: only scanning, problems, and Scan.
 */
export function PriceSources({ sources, empty, variant = "prices" }: { sources: PriceSource[]; empty: boolean; variant?: "prices" | "facilities" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [visibility, setVisibility] = useState("public");

  // "✓ Found 12 items" once a read that was going on here ends.
  const readingKeys = sources.filter((s) => s.reading).map((s) => s.key).join(",");
  const [wasReading, setWasReading] = useState(readingKeys);
  const [found, setFound] = useState<Record<string, number>>({});
  if (wasReading !== readingKeys) {
    const was = new Set(wasReading.split(",").filter(Boolean));
    const next = { ...found };
    for (const s of sources) if (was.has(s.key) && !s.reading && !s.error) next[s.key] = s.items;
    setWasReading(readingKeys);
    setFound(next);
  }

  const run = (fn: () => Promise<{ error?: string }>, then?: () => void) =>
    start(async () => {
      setError(null);
      const result = await fn();
      if (result.error) return setError(result.error);
      then?.();
      router.refresh();
    });
  const reading = sources.some((s) => s.reading);
  const lookAgain = sources.length > 0 && (
    <button type="button" className="btn-ghost ml-auto py-1 text-xs" disabled={pending || reading} onClick={() => run(rereadOfferingsAction)}>↻ Scan</button>
  );

  const addForm = (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <input className="input min-w-0 flex-1" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… menu page, PDF or photo" aria-label="Link to your menu or price list" />
        <select className="input w-auto" value={visibility} onChange={(e) => setVisibility(e.target.value)} aria-label="Who it's for">
          <option value="public">Public</option>
          <option value="customers">Customers only</option>
        </select>
        <button type="button" className="btn-primary" disabled={pending || !url.trim()} onClick={() => run(() => addSourceAction(url, visibility), () => { setUrl(""); setAdding(false); })}>Add</button>
      </div>
      <p className="hint">It&apos;s added to Website &amp; links too, and read again daily.</p>
    </div>
  );

  if (variant === "facilities") {
    const problems = sources.filter((s) => s.error && !s.reading);
    if (!sources.length) return null;
    return (
      <div className="space-y-1" data-testid="offerings-reading">
        <div className="flex items-center gap-2 text-xs text-muted">
          {reading ? <Thinking label="Scanning your website and documents" /> : <span>From your website and documents</span>}
          {lookAgain}
        </div>
        {problems.map((s) => <p key={s.key} className="text-xs text-danger" data-testid="offerings-problem">⚠️ {s.label}: {s.error}</p>)}
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      </div>
    );
  }

  // Nothing yet: adding the menu is the first step.
  if (empty && !reading) {
    return (
      <section className="card space-y-3 border-accent/40" data-testid="add-menu" aria-label="Add your menu or price list">
        <div>
          <h2 className="font-semibold">📄 Add your menu or price list</h2>
          <p className="text-xs text-muted">Your agent reads the products, services and prices from it. A page, PDF or photo link.</p>
        </div>
        {addForm}
        {sources.length > 0 && (
          <ul className="space-y-1 text-xs text-muted">
            {sources.map((s) => <li key={s.key}>{s.label}: {s.error ? <span className="text-danger">⚠️ {s.error}</span> : "no prices found in it"}</li>)}
          </ul>
        )}
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        {sources.length > 0 && <div className="flex">{lookAgain}</div>}
      </section>
    );
  }

  return (
    <section className="card space-y-2 p-3" data-testid="price-sources" aria-label="Where your prices come from">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">Where your prices come from</h2>
        {lookAgain}
      </div>
      {sources.length === 0 && <p className="text-xs text-muted">Only prices you added yourself so far.</p>}
      <ul className="divide-y divide-border">
        {sources.map((s) => (
          <li key={s.key} className="flex items-baseline gap-2 py-1.5 text-sm" data-testid="price-source">
            <span aria-hidden>{s.site ? "🌐" : "📄"}</span>
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
            <span className="shrink-0 text-xs text-muted">
              {s.reading ? (
                <Thinking label="Scanning" className="text-accent" />
              ) : s.error ? (
                <span className="text-danger">⚠️ {s.error}</span>
              ) : found[s.key] !== undefined ? (
                <span className="text-accent" role="status">✓ Found {items(found[s.key])}</span>
              ) : s.items ? (
                <>{items(s.items)}{s.site && ` on ${s.pages} ${s.pages === 1 ? "page" : "pages"}`}{s.readAt && <> · <LocalTime iso={s.readAt} /></>}</>
              ) : (
                "No prices in it"
              )}
            </span>
          </li>
        ))}
      </ul>
      {reading && <p className="hint">This takes up to a minute for a long menu. You can leave this page.</p>}
      {adding ? addForm : (
        <button type="button" className="text-sm text-accent" onClick={() => setAdding(true)}>＋ Add a menu or price list</button>
      )}
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
    </section>
  );
}
