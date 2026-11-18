"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LocalTime } from "@/components/LocalTime";
import { sourceLabel } from "@/lib/business/offerings-shared";
import { Thinking } from "@/components/Thinking";
import { addSourceAction, removeSourceAction, rereadSourceAction, saveBusinessInfoAction, saveBusinessDetailsAction, setSourceVisibilityAction, tryQuestionAction } from "./actions";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";
import { CountedField } from "@/components/CountedField";
import { BUSINESS_LIMITS } from "@/lib/social/limits";

/** "About your business" (public) and "For customers only", in your own words. */
export function BusinessInfoForm({ about = "", customers = "", mode = "about" }: { about?: string; customers?: string; mode?: "about" | "customers" }) {
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
          {state.addedLinks ? ` ${state.addedLinks} linked ${state.addedLinks === 1 ? "page was" : "pages were"} added to Website & documents with the same visibility.` : ""}
        </p>
      )}
      <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : mode === "about" ? "Save description" : "Save customer information"}</button>
    </form>
  );
}

export function BusinessDetailsForm({ hours, address, fromWebsite }: { hours: string; address: string; fromWebsite: boolean }) {
  const [state, action, pending] = useActionState(saveBusinessDetailsAction, undefined);
  return <form action={action} className="space-y-3" aria-label="Business details">
    {fromWebsite && <p className="hint">Available details from your published website are filled in. Save your changes to override them.</p>}
    <CountedField id="hours" label="Opening hours" max={BUSINESS_LIMITS.hours} maxRows={5} defaultValue={hours} />
    <CountedField id="address" label="Business address" max={BUSINESS_LIMITS.address} maxRows={5} defaultValue={address} />
    {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
    {state?.saved && <p role="status" className="text-sm text-accent">Saved. Your page and agent use these details.</p>}
    <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save business details"}</button>
  </form>;
}

type Source = { fromText: string | null; id: string; url: string; visibility: string; status: string; kind: string | null; error: string | null; offerings_error: string | null; reading_prices: boolean; last_read_at: string | null; prices: number };

const KIND: Record<string, { label: string; icon: string }> = { page: { label: "Web page", icon: "🌐" }, pdf: { label: "PDF", icon: "📄" }, image: { label: "Photo", icon: "🖼️" }, text: { label: "Text", icon: "📝" } };

/** Links your agent reads: website, PDF menu, menu photos. */
export function SourcesManager({ sources }: { sources: Source[] }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      const result = await fn();
      setError(result.error ?? null);
      router.refresh();
    });

  return (
    <div className="space-y-3">
      {sources.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border">
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
      <div className="flex flex-wrap gap-2">
        <input
          className="input min-w-0 flex-1"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Link to a page, PDF or photo"
          aria-label="Link to read"
        />
        <select className="input w-auto" value={visibility} onChange={(e) => setVisibility(e.target.value)} aria-label="Visibility of the new link">
          <option value="public">Public</option>
          <option value="customers">Customers only</option>
        </select>
        <button
          type="button"
          className="btn-primary"
          disabled={pending || !url.trim()}
          onClick={() =>
            act(async () => {
              const result = await addSourceAction(url, visibility);
              if (!result.error) setUrl("");
              return result;
            })
          }
        >
          Add link
        </button>
      </div>
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
