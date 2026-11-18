"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LocalTime } from "@/components/LocalTime";
import { sourceLabel } from "@/lib/business/offerings-shared";
import { MAX_SITE_PAGES } from "@/lib/business/site";
import { PendingWebsiteRow, WebsiteRow, type WebsiteSummary } from "./WebsiteCard";
import { startWebsiteAction } from "./website-actions";
import { Thinking } from "@/components/Thinking";
import { addSourceAction, removeSourceAction, rereadSourceAction, saveBusinessInfoAction, setSourceVisibilityAction, tryQuestionAction } from "./actions";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";
import { CountedField } from "@/components/CountedField";
import { BUSINESS_LIMITS } from "@/lib/social/limits";

/** "About your business" with opening hours and address (public), or "For customers only", in your own words. */
export function BusinessInfoForm({ about = "", customers = "", mode = "about", details }: { about?: string; customers?: string; mode?: "about" | "customers"; details?: { hours: string; address: string; fromWebsite: boolean } }) {
  const [state, action, pending] = useActionState(saveBusinessInfoAction, undefined);
  return (
    <form action={action} className="space-y-4" aria-label={mode === "about" ? "Business description" : "Customer-only information"}>
      {mode === "about" && <div>
        <CountedField
          id="about"
          label="About your business"
          max={BUSINESS_LIMITS.about}
          minRows={5}
          maxRows={16}
          defaultValue={about}
          placeholder={"Family-run Italian restaurant in Camden.\nSeasonal dishes, handmade pasta and a warm welcome for friends and families."}
        />
        <p className="hint mt-1">
          Introduce your business to customers: what you offer and what makes it special.
        </p>
      </div>}
      {mode === "about" && details && <div id="business-information" className="scroll-mt-40 space-y-3">
        {details.fromWebsite && <p className="hint">Hours and address from your published website are filled in. Save to use your own.</p>}
        <CountedField id="hours" label="Opening hours" max={BUSINESS_LIMITS.hours} maxRows={5} defaultValue={details.hours} />
        <CountedField id="address" label="Business address" max={BUSINESS_LIMITS.address} maxRows={5} defaultValue={details.address} />
        {/* What was shown, so hours or an address from the website are only saved as yours when you change them. */}
        <input type="hidden" name="hours_was" value={details.hours} />
        <input type="hidden" name="address_was" value={details.address} />
      </div>}
      {mode === "customers" && <div>
        <label className="label" htmlFor="customers">For customers only <span className="font-normal text-muted">· your contacts</span></label>
        <AutoGrowTextarea id="customers" name="customers" className="input" minRows={2} maxRows={8} maxLength={4000} defaultValue={customers} placeholder="e.g. Private events: £35 per person, minimum 20 people." />
        <p className="hint mt-1">
          Only for people in your Contacts, when they ask your agent directly. Never shown in groups or communities, where others can read the
          answer.
        </p>
      </div>}
      {state?.error && <p className="text-sm text-danger" role="alert">{state.error}</p>}
      {state?.saved && (
        <p className="text-sm text-accent" role="status">
          Saved. Your agent uses this straight away.
          {state.addedLinks ? ` ${state.addedLinks} linked ${state.addedLinks === 1 ? "page was" : "pages were"} added to Website & links with the same visibility.` : ""}
        </p>
      )}
      <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : mode === "about" ? "Save" : "Save customer information"}</button>
    </form>
  );
}

type Source = { fromText: string | null; id: string; url: string; visibility: string; status: string; kind: string | null; error: string | null; offerings_error: string | null; reading_prices: boolean; last_read_at: string | null; prices: number };

const KIND: Record<string, { label: string; icon: string }> = { page: { label: "Web page", icon: "🌐" }, pdf: { label: "PDF", icon: "📄" }, image: { label: "Photo", icon: "🖼️" }, text: { label: "Text", icon: "📝" } };

/** "https://" added when left out (people paste "trattoria-camden.co.uk"). */
const withScheme = (raw: string) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
/** A site's home address (nothing after the domain): the whole website may be meant. */
function homeAddress(link: string) {
  try {
    const u = new URL(link);
    return u.pathname.replace(/\/+$/, "") === "" && !u.search;
  } catch {
    return false;
  }
}

type WebsiteInfo = { site: WebsiteSummary | null; verified: boolean; canVerifyByEmail: boolean; lookup: boolean; pending: { url: string; notice: string } | null };

/**
 * "Website & links": everything your agent learns from, in one list with one box. Your website comes
 * first (the whole site, read up to 30 pages); then pages, PDFs and photos, each read on its own.
 */
export function SourcesManager({ sources, website }: { sources: Source[]; website: WebsiteInfo }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [ask, setAsk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      const result = await fn();
      setError(result.error ?? null);
      router.refresh();
    });
  const addLink = (link: string) =>
    act(async () => {
      const result = await addSourceAction(link, visibility);
      if (!result.error) { setUrl(""); setAsk(null); }
      return result;
    });
  const add = () => {
    const link = withScheme(url);
    if (!website.site && homeAddress(link)) return setAsk(link);
    addLink(link);
  };
  const hasRows = Boolean(website.site || website.pending || sources.length);

  return (
    <div className="space-y-3">
      {hasRows && (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {website.site ? (
            <WebsiteRow site={website.site} verified={website.verified} canVerifyByEmail={website.canVerifyByEmail} lookup={website.lookup} />
          ) : website.pending ? (
            <PendingWebsiteRow url={website.pending.url} notice={website.pending.notice} />
          ) : null}
          {sources.map((s) => {
            const kind = KIND[s.kind ?? "page"] ?? KIND.page;
            const scanning = s.status === "pending" || s.status === "reading";
            return (
              <li key={s.id} className="flex items-start gap-3 px-3 py-3 sm:items-center" data-testid="business-source">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-base" aria-hidden>{kind.icon}</span>
                {/* Name and status; on a phone the controls go underneath, so the name has room. */}
                <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                  <div className="min-w-0 flex-1">
                    <a href={s.url} target="_blank" rel="noreferrer noopener" title={s.url} className="block truncate text-sm font-medium hover:text-accent hover:underline">
                      {sourceLabel(s.url)}
                    </a>
                    <p className="mt-0.5 truncate text-xs text-muted" data-testid="source-status">
                      {scanning ? (
                        <Thinking label="Scanning" className="text-accent" />
                      ) : s.status === "error" ? (
                        <span className="text-danger">Couldn&apos;t read it: {s.error}</span>
                      ) : (
                        <>
                          {kind.label} · Scanned <LocalTime iso={s.last_read_at ?? new Date(0).toISOString()} />
                          {s.reading_prices ? (
                            <> · <Thinking label="Finding prices" className="text-accent" /></>
                          ) : s.offerings_error ? (
                            <span className="text-danger" data-testid="source-offerings-error"> · {s.offerings_error}</span>
                          ) : s.prices > 0 ? (
                            <> · <Link href="/business/prices" className="text-accent hover:underline">{s.prices} {s.prices === 1 ? "price" : "prices"}</Link></>
                          ) : null}
                        </>
                      )}
                      {s.fromText && (
                        <span data-testid="source-from-text" title="This address is also written in your text above, so your agent can give it to customers too."> · Linked in {s.fromText}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <select
                      className="input w-auto py-1 text-xs"
                      value={s.visibility}
                      aria-label="Who can see this"
                      disabled={pending}
                      onChange={(e) => act(() => setSourceVisibilityAction(s.id, e.target.value))}
                    >
                      <option value="public">Public</option>
                      <option value="customers">Customers only</option>
                    </select>
                    <button type="button" className="rounded-lg px-2 py-1 text-muted hover:bg-accent-soft hover:text-accent disabled:opacity-40" aria-label={`Scan ${sourceLabel(s.url)}`} title="Scan" disabled={pending || scanning} onClick={() => act(() => rereadSourceAction(s.id))}>↻</button>
                    <button type="button" className="rounded-lg px-2 py-1 text-muted hover:bg-accent-soft hover:text-danger disabled:opacity-40" aria-label={`Remove ${sourceLabel(s.url)}`} title="Remove" disabled={pending} onClick={() => act(() => removeSourceAction(s.id))}>✕</button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input
          className="input w-full min-w-0 sm:w-auto sm:flex-1"
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          value={url}
          onChange={(e) => { setUrl(e.target.value); setAsk(null); }}
          placeholder="Paste a link: your website, a menu, a PDF or a photo"
          aria-label="Link to read"
        />
        <select className="input w-auto flex-1 sm:flex-none" value={visibility} onChange={(e) => setVisibility(e.target.value)} aria-label="Visibility of the new link">
          <option value="public">Public</option>
          <option value="customers">Customers only</option>
        </select>
        <button className="btn-primary" disabled={pending || !url.trim()}>Add link</button>
      </form>
      {/* A website's home address: the whole site, or only that page? Asked once, while no website is connected. */}
      {ask && (
        <div className="space-y-2 rounded-xl border border-accent/40 bg-accent-soft/40 p-3" data-testid="whole-site-choice">
          <p className="text-sm font-medium">This looks like your website. What should your agent read?</p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primary" disabled={pending} onClick={() => start(async () => { setError(null); const r = await startWebsiteAction(ask); if (r.error) setError(r.error); else router.push("/business/setup"); })}>
              {pending ? "Starting…" : `The whole website (up to ${MAX_SITE_PAGES} pages)`}
            </button>
            <button type="button" className="btn-ghost" disabled={pending} onClick={() => addLink(ask)}>Just this page</button>
            <button type="button" className="text-sm text-muted hover:text-foreground" onClick={() => setAsk(null)}>Cancel</button>
          </div>
          <p className="hint">The whole website: you check what your agent learned before it goes live, then it&apos;s scanned again daily and can earn the ✓ Verified badge. A website is always public.</p>
        </div>
      )}
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <p className="hint" data-testid="visibility-hint"><b className="font-medium">Public:</b> used when answering anyone. <b className="font-medium">Customers only:</b> used only in one-to-one chats with your contacts. Scanned again daily.</p>
    </div>
  );
}

/** Ask a test question, as a visitor or as a customer. */
export function TryIt() {
  const [question, setQuestion] = useState("");
  const [asCustomer, setAsCustomer] = useState(false);
  const [result, setResult] = useState<{ answer?: string; needsTeam?: boolean; error?: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <input
          className="input min-w-0 flex-1"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && question.trim()) {
              e.preventDefault();
              start(async () => setResult(await tryQuestionAction(question, asCustomer)));
            }
          }}
          placeholder="Type a question a customer might ask, e.g. Do you have vegan options?"
          aria-label="Test question"
        />
        <button type="button" className="btn-primary" disabled={pending || !question.trim()} onClick={() => start(async () => setResult(await tryQuestionAction(question, asCustomer)))}>
          {pending ? "Thinking…" : "See the answer"}
        </button>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={asCustomer} onChange={(e) => setAsCustomer(e.target.checked)} /> Ask as one of my customers (sees customers-only info too)
      </label>
      {result?.error && <p className="text-sm text-danger" role="alert">{result.error}</p>}
      {result?.answer && (
        <div className="rounded-xl border border-agent-border bg-agent px-3 py-2 text-sm" data-testid="try-answer">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">Your agent would answer</span>
          {result.answer}
          {result.needsTeam && <p className="mt-1 text-xs text-muted">For a relevant unanswered question, a real visitor can choose Ask the team. This preview sends no request.</p>}
        </div>
      )}
    </div>
  );
}
