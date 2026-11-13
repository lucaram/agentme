"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LocalTime } from "@/components/LocalTime";
import { verifyTag } from "@/lib/business/site";
import { removeWebsiteAction, rereadWebsiteAction, setSiteLookupAction, startWebsiteAction, verifyWebsiteAction } from "./website-actions";

export type WebsiteSummary = {
  domain: string;
  url: string;
  status: string;
  pagesRead: number;
  lastReadAt: string | null;
  live: boolean;
  warning: string | null;
  error: string | null;
  verifyToken: string;
};

/** "Your website": the whole site your agent reads (and re-reads every day), with the ✓ Verified badge. */
export function WebsiteCard({ site, verified, canVerifyByEmail, lookup = true }: { site: WebsiteSummary | null; verified: boolean; canVerifyByEmail: boolean; lookup?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const run = (fn: () => Promise<{ error?: string }>, then?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.error) setError(r.error);
      else (then ?? (() => router.refresh()))();
    });

  if (!site) {
    return (
      <div className="space-y-2 rounded-xl border border-accent/50 bg-accent-soft/50 p-3" data-testid="website-card">
        <h3 className="text-sm font-semibold">🌐 Have a website? Paste it and your agent learns all of it</h3>
        <p className="text-xs text-muted">Menu, prices, hours, policies: read in under a minute, checked by you, then kept up to date every day.</p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
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
          <button className="btn-primary shrink-0" disabled={pending || !value.trim()}>{pending ? "Starting…" : "Read my website"}</button>
        </form>
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
          <>Reading your website… <Link href="/business/setup" className="text-accent underline">See progress</Link></>
        ) : site.status === "error" ? (
          <span className="text-danger">{site.error}</span>
        ) : (
          <>
            {site.pagesRead} {site.pagesRead === 1 ? "page" : "pages"} read
            {site.lastReadAt && (
              <>
                {" "}· checked <LocalTime iso={site.lastReadAt} />
              </>
            )}{" "}
            · re-read every day
          </>
        )}
      </p>
      {site.status === "ready" && site.error && <p className="text-xs text-amber-600 dark:text-amber-400">Last check didn&apos;t work: {site.error} Your agent keeps using what it read before.</p>}
      {site.warning && <p className="text-xs text-amber-600 dark:text-amber-400">⚠️ {site.warning}</p>}

      <div className="flex flex-wrap gap-2">
        <Link href="/business/setup" className={site.live ? "btn-ghost" : "btn-primary"} data-testid="review-learned">
          {site.live ? "What your agent learned" : "Review and go live"}
        </Link>
        <button type="button" className="btn-ghost" disabled={pending || site.status === "reading"} onClick={() => run(rereadWebsiteAction)}>
          ↻ Re-read now
        </button>
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

      {site.live && (
        <label className="flex items-start gap-2 text-sm" data-testid="site-lookup">
          <input type="checkbox" className="mt-1" checked={lookup} disabled={pending} onChange={(e) => run(() => setSiteLookupAction(e.target.checked))} />
          <span>
            Look things up on my website when unsure
            <span className="block text-xs text-muted">
              If a customer asks about a page your agent hasn&apos;t read yet, it finds that page on {site.domain}, reads it and answers from it (with the page it came from). Off: it asks your team instead.
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
