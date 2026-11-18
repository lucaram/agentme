"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LocalTime } from "@/components/LocalTime";
import { Thinking } from "@/components/Thinking";
import { verifyTag } from "@/lib/business/site";
import { removeWebsiteAction, rereadWebsiteAction, setSiteLookupAction, setAutomaticRefreshAction, startWebsiteAction, verifyWebsiteAction } from "./website-actions";

export type WebsiteSummary = {
  domain: string;
  url: string;
  status: string;
  pagesRead: number;
  lastReadAt: string | null;
  lastSuccessAt?: string | null;
  autoRefresh?: boolean;
  live: boolean;
  /** Pages that prices were read from (shown with a link to Prices), and whether they're being read now. */
  pricePages?: number;
  readingPrices?: boolean;
  warning: string | null;
  error: string | null;
  verifyToken: string;
};

const ICON = "grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-base";
const ICON_BUTTON = "rounded-lg px-2 py-1 text-muted hover:bg-accent-soft disabled:opacity-40";

/**
 * Your website, as the first row of "Website & links": the whole site your agent reads (up to 30 pages,
 * again every day), reviewed before it goes live, with the ✓ Verified badge. Its settings fold away.
 */
export function WebsiteRow({ site, verified, canVerifyByEmail, lookup = true }: { site: WebsiteSummary; verified: boolean; canVerifyByEmail: boolean; lookup?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [value, setValue] = useState(site.url);
  const [automatic, setAutomatic] = useOptimistic(site.autoRefresh !== false);
  const [lookups, setLookups] = useOptimistic(lookup);
  const run = (fn: () => Promise<{ error?: string }>, then?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.error) setError(r.error);
      else (then ?? (() => router.refresh()))();
    });
  const scanning = site.status === "reading";

  return (
    <li className="space-y-2 px-3 py-3" data-testid="website-card">
      <div className="flex items-start gap-3 sm:items-center">
        <span className={ICON} aria-hidden>🌐</span>
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <a href={site.url} target="_blank" rel="noopener noreferrer nofollow" className="truncate text-sm font-medium hover:text-accent hover:underline">{site.domain}</a>
              {verified ? (
                <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent" data-testid="verified-badge">✓ Verified</span>
              ) : (
                <span className="shrink-0 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted">Not verified</span>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted" data-testid="website-status">
              {scanning ? (
                <><Thinking label="Scanning your website" className="text-accent" /> · <Link href="/business/setup" className="text-accent hover:underline">See progress</Link></>
              ) : site.status === "error" ? (
                <span className="text-danger">{site.error}</span>
              ) : (
                <>
                  Website · {site.pagesRead} {site.pagesRead === 1 ? "page" : "pages"} read
                  {site.live ? <span className="text-accent"> · ● Live</span> : <span className="text-amber-600 dark:text-amber-400"> · Not live yet</span>}
                  {site.readingPrices ? (
                    <> · <Thinking label="Finding prices" className="text-accent" /></>
                  ) : site.pricePages ? (
                    <> · <Link href="/business/prices" className="text-accent hover:underline" data-testid="site-price-pages">{site.pricePages} {site.pricePages === 1 ? "page" : "pages"} with prices</Link></>
                  ) : null}
                </>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Link href="/business/setup" className={`${site.live ? "btn-ghost" : "btn-primary"} px-3 py-1 text-xs`} data-testid="review-learned">
              {site.live ? "What it learned" : "Review and go live"}
            </Link>
            <button type="button" className={`${ICON_BUTTON} hover:text-accent`} aria-label={`Scan ${site.domain}`} title="Scan" disabled={pending || scanning} onClick={() => run(rereadWebsiteAction)}>↻</button>
            <button
              type="button"
              className={`${ICON_BUTTON} hover:text-danger`}
              aria-label="Remove"
              title="Remove"
              disabled={pending}
              onClick={() => {
                if (confirm(`Stop using ${site.domain}? Your agent forgets its pages and what it learned (your own words, fixes and Questions & answers stay).`)) run(removeWebsiteAction);
              }}
            >
              ✕
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-2 sm:pl-12">
        {site.status === "ready" && site.error && <p className="text-xs text-amber-600 dark:text-amber-400">Last check didn&apos;t work: {site.error} Your agent keeps using what it read before.</p>}
        {site.warning && <p className="text-xs text-amber-600 dark:text-amber-400">⚠️ {site.warning}</p>}
        <details className="group text-sm">
          <summary className="cursor-pointer text-xs text-muted hover:text-foreground">Website settings{verified ? "" : " and the Verified badge"}</summary>
          <div className="mt-2 space-y-3">
            <p className="hint">
              Last successful check: {site.lastSuccessAt ? <LocalTime iso={site.lastSuccessAt} /> : "not recorded yet"}.
              {site.error && site.lastReadAt && <> Last attempt: <LocalTime iso={site.lastReadAt} />.</>}
            </p>
            {site.live && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={automatic} disabled={pending} onChange={(e) => { const enabled = e.target.checked; run(async () => { setAutomatic(enabled); return setAutomaticRefreshAction(enabled); }); }} />
                <span>Automatic website updates<span className="block text-xs text-muted">Scanned again about every 24 hours.</span></span>
              </label>
            )}
            {site.live && (
              <label className="flex items-start gap-2 text-sm" data-testid="site-lookup">
                <input type="checkbox" className="mt-1" checked={lookups} disabled={pending} onChange={(e) => { const enabled = e.target.checked; run(async () => { setLookups(enabled); return setSiteLookupAction(enabled); }); }} />
                <span>
                  Look things up on my website when unsure
                  <span className="block text-xs text-muted">Your agent can find other pages on {site.domain} when answering. If it still can&apos;t answer, the customer can ask your team.</span>
                </span>
              </label>
            )}
            {!verified && site.status !== "error" && <Verify site={site} canVerifyByEmail={canVerifyByEmail} />}
            {changing ? (
              <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); run(() => startWebsiteAction(value), () => router.push("/business/setup")); }}>
                <input className="input min-w-0 flex-1" inputMode="url" autoCapitalize="none" spellCheck={false} maxLength={300} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Your new website" />
                <button className="btn-primary" disabled={pending || !value.trim()}>{pending ? "Starting…" : "Scan new website"}</button>
                <button type="button" className="btn-ghost" onClick={() => setChanging(false)}>Cancel</button>
              </form>
            ) : (
              <button type="button" className="text-xs text-accent hover:underline" disabled={pending || scanning} onClick={() => setChanging(true)}>Change website</button>
            )}
          </div>
        </details>
        {error && <p className="text-xs text-danger" role="alert">{error}</p>}
      </div>
    </li>
  );
}

/** A website given at sign-up that couldn't be connected yet: try again, or remove it from the list. */
export function PendingWebsiteRow({ url, notice }: { url: string; notice: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="flex items-start gap-3 px-3 py-3 sm:items-center" data-testid="website-card">
      <span className={ICON} aria-hidden>🌐</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={url}>{url.replace(/^https?:\/\//, "")}</p>
          <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400" data-testid="website-notice">{notice}</p>
          {error && <p className="text-xs text-danger" role="alert">{error}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="btn-primary px-3 py-1 text-xs"
            disabled={pending}
            onClick={() => start(async () => { setError(null); const r = await startWebsiteAction(url); if (r.error) setError(r.error); else router.push("/business/setup"); })}
          >
            {pending ? "Starting…" : "Retry connection"}
          </button>
          <button
            type="button"
            className={`${ICON_BUTTON} hover:text-danger`}
            aria-label="Remove"
            title="Remove"
            disabled={pending}
            onClick={() => start(async () => { setError(null); const r = await removeWebsiteAction(); if (r.error) setError(r.error); else router.refresh(); })}
          >
            ✕
          </button>
        </div>
      </div>
    </li>
  );
}

/** ✓ Verified: proves the website is yours (one business per website), shown on your page and in search. */
function Verify({ site, canVerifyByEmail }: { site: WebsiteSummary; canVerifyByEmail: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const tag = verifyTag(site.verifyToken);
  const verify = (method: "email" | "meta") =>
    start(async () => {
      const r = await verifyWebsiteAction(method);
      if (r.error) setMessage({ ok: false, text: r.error });
      else router.refresh();
    });
  return (
    <div className="space-y-2 rounded-xl bg-accent-soft/40 p-3 text-sm">
      <p className="font-medium">✓ Get the Verified badge for {site.domain}</p>
      <p className="text-xs text-muted">It shows customers this is really your business, on your page and in search. Only one business can verify a website.</p>
      {canVerifyByEmail && (
        <button type="button" className="btn-primary" disabled={pending} onClick={() => verify("email")}>
          Verify with my email at {site.domain}
        </button>
      )}
      <p className="text-xs">{canVerifyByEmail ? "Or add" : "Add"} this line inside the &lt;head&gt; of your homepage (or ask whoever runs your website), then check:</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-surface px-2 py-1.5 text-xs" data-testid="verify-tag">{tag}</code>
        <button type="button" className="btn-ghost shrink-0 px-3 py-1 text-xs" onClick={() => { void navigator.clipboard?.writeText(tag).then(() => setCopied(true)); }}>
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <button type="button" className="btn-ghost" disabled={pending} onClick={() => verify("meta")}>
        {pending ? "Checking…" : "Check my homepage"}
      </button>
      {message && <p className={`text-xs ${message.ok ? "text-accent" : "text-danger"}`} role="alert">{message.text}</p>}
    </div>
  );
}
