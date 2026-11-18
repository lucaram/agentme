"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LocalTime } from "@/components/LocalTime";
import { Thinking } from "@/components/Thinking";
import { MAX_SITE_PAGES, verifyTag } from "@/lib/business/site";
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

/** "Your website": the whole site your agent reads (and re-reads every day), with the ✓ Verified badge. */
export function WebsiteCard({ site, verified, canVerifyByEmail, lookup = true, initialValue = "", notice }: { site: WebsiteSummary | null; verified: boolean; canVerifyByEmail: boolean; lookup?: boolean; initialValue?: string; /** Why it is not connected yet (e.g. the sign-up connection failed); shown until you try again. */ notice?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showNotice, setShowNotice] = useState(Boolean(notice));
  const [value, setValue] = useState(initialValue);
  const [changing, setChanging] = useState(false);
  const [automatic, setAutomatic] = useOptimistic(site?.autoRefresh !== false);
  const [lookups, setLookups] = useOptimistic(lookup);
  const run = (fn: () => Promise<{ error?: string }>, then?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.error) setError(r.error);
      else (then ?? (() => router.refresh()))();
    });

  if (!site || changing) {
    return (
      <div className="space-y-2 rounded-xl border border-accent/50 bg-accent-soft/50 p-3" data-testid="website-card">
        <h3 className="text-sm font-semibold">{changing ? "Change your website" : "Connect your website"}</h3>
        <p className="text-xs text-muted">
          Your agent reads up to {MAX_SITE_PAGES} pages of your site. You check what it learned, then go live. After that, it re-reads your site daily and can look up other pages when
          customers ask.
        </p>
        {showNotice && notice && !changing && <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="website-notice">{notice}</p>}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setShowNotice(false);
            run(() => startWebsiteAction(value), () => router.push("/business/setup"));
          }}
        >
          <input
            className="input"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={300}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. trattoria-camden.co.uk"
            aria-label="Your website"
          />
          <button className="btn-primary shrink-0" disabled={pending || !value.trim()}>{pending ? "Starting…" : !changing && initialValue ? "Retry connection" : "Read my website"}</button>
        </form>
        {changing && <button className="btn-ghost" onClick={() => setChanging(false)}>Cancel</button>}
        {error && <p className="text-xs text-danger" role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-border p-3" data-testid="website-card">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg" aria-hidden>🌐</span>
        <a href={site.url} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold hover:underline">{site.domain}</a>
        {verified ? (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent" data-testid="verified-badge">✓ Verified</span>
        ) : (
          <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted">Not verified</span>
        )}
        {site.live ? (
          <span className="ml-auto text-xs text-accent">● Live</span>
        ) : (
          site.status === "ready" && <span className="ml-auto text-xs text-amber-600 dark:text-amber-400">Not live yet</span>
        )}
      </div>

      <p className="text-sm text-muted" data-testid="website-status">
        {site.status === "reading" ? (
          <><Thinking label="Reading your website" /> <Link href="/business/setup" className="text-accent underline">See progress</Link></>
        ) : site.status === "error" ? (
          <span className="text-danger">{site.error}</span>
        ) : (
          <>
            {site.pagesRead} {site.pagesRead === 1 ? "page" : "pages"} read
            {site.readingPrices ? (
              <> · <Thinking label="Reading prices" className="text-accent" /></>
            ) : site.pricePages ? (
              <> · <Link href="/business/prices" className="text-accent underline" data-testid="site-price-pages">💷 Prices found on {site.pricePages} {site.pricePages === 1 ? "page" : "pages"}</Link></>
            ) : null}
          </>
        )}
      </p>
      <p className="hint">Last successful check: {site.lastSuccessAt ? <LocalTime iso={site.lastSuccessAt} /> : "not recorded yet"}.</p>
      {site.error && site.lastReadAt && <p className="hint">Last attempt: <LocalTime iso={site.lastReadAt} />.</p>}
      {site.status === "ready" && site.error && <p className="text-xs text-amber-600 dark:text-amber-400">Last check didn&apos;t work: {site.error} Your agent keeps using what it read before.</p>}
      {site.warning && <p className="text-xs text-amber-600 dark:text-amber-400">⚠️ {site.warning}</p>}

      <div className="flex flex-wrap gap-2">
        <Link href="/business/setup" className={site.live ? "btn-ghost" : "btn-primary"} data-testid="review-learned">
          {site.live ? "What your agent learned" : "Review and go live"}
        </Link>
        <button type="button" className="btn-ghost" disabled={pending || site.status === "reading"} onClick={() => run(rereadWebsiteAction)}>
          ↻ Re-read now
        </button>
        <button type="button" className="btn-ghost" disabled={pending || site.status === "reading"} onClick={() => { setValue(site.url); setChanging(true); }}>Change website</button>
        <button
          type="button"
          className="btn-ghost text-muted"
          disabled={pending}
          onClick={() => {
            if (confirm(`Stop using ${site.domain}? Your agent forgets its pages and what it learned (your own words, fixes and Questions & answers stay).`)) run(removeWebsiteAction);
          }}
        >
          Remove
        </button>
      </div>

      {site.live && <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={automatic} disabled={pending} onChange={(e) => { const enabled = e.target.checked; run(async () => { setAutomatic(enabled); return setAutomaticRefreshAction(enabled); }); }} />
        <span>Automatic website updates<span className="block text-xs text-muted">Checks approximately every 24 hours while the AGENTME service is running. You can also re-read now.</span></span>
      </label>}
      {site.live && (
        <label className="flex items-start gap-2 text-sm" data-testid="site-lookup">
          <input type="checkbox" className="mt-1" checked={lookups} disabled={pending} onChange={(e) => { const enabled = e.target.checked; run(async () => { setLookups(enabled); return setSiteLookupAction(enabled); }); }} />
          <span>
            Look things up on my website when unsure
            <span className="block text-xs text-muted">
              Your agent can find additional pages on {site.domain} when answering a question. When it still cannot answer, the customer can choose Ask the team.
            </span>
          </span>
        </label>
      )}

      {!verified && site.status !== "error" && <Verify site={site} canVerifyByEmail={canVerifyByEmail} />}
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
    </div>
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
    <details className="group rounded-xl bg-accent-soft/40 p-3 text-sm">
      <summary className="cursor-pointer font-medium">✓ Get the Verified badge for {site.domain}</summary>
      <div className="mt-2 space-y-3">
        <p className="text-xs text-muted">It shows customers this is really your business, on your page and in search. Only one business can verify a website.</p>
        {canVerifyByEmail && (
          <button type="button" className="btn-primary" disabled={pending} onClick={() => verify("email")}>
            Verify with my email at {site.domain}
          </button>
        )}
        <div className="space-y-2">
          <p className="text-xs">{canVerifyByEmail ? "Or add" : "Add"} this line inside the &lt;head&gt; of your homepage (or ask whoever runs your website), then check:</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-surface px-2 py-1.5 text-xs" data-testid="verify-tag">{tag}</code>
            <button
              type="button"
              className="btn-ghost shrink-0 px-3 py-1 text-xs"
              onClick={() => {
                void navigator.clipboard?.writeText(tag).then(() => setCopied(true));
              }}
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <button type="button" className="btn-ghost" disabled={pending} onClick={() => verify("meta")}>
            {pending ? "Checking…" : "Check my homepage"}
          </button>
        </div>
        {message && <p className={`text-xs ${message.ok ? "text-accent" : "text-danger"}`} role="alert">{message.text}</p>}
      </div>
    </details>
  );
}
