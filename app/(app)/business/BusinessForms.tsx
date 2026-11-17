"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LocalTime } from "@/components/LocalTime";
import { addSourceAction, createSourceButtonAction, removeSourceAction, rereadSourceAction, saveBusinessInfoAction, saveBusinessDetailsAction, setSourceVisibilityAction, tryQuestionAction } from "./actions";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";
import { SectionLink } from "@/components/SectionLink";

/** "About your business" (public) and "For customers only", in your own words. */
export function BusinessInfoForm({ about = "", customers = "", mode = "about" }: { about?: string; customers?: string; mode?: "about" | "customers" }) {
  const [state, action, pending] = useActionState(saveBusinessInfoAction, undefined);
  return (
    <form action={action} className="space-y-4" aria-label={mode === "about" ? "Business description" : "Customer-only information"}>
      {mode === "about" && <div>
        <label className="label" htmlFor="about">About your business <span className="font-normal text-muted">· public</span></label>
        <AutoGrowTextarea
          id="about"
          name="about"
          className="input"
          minRows={5}
          maxRows={16}
          maxLength={8000}
          defaultValue={about}
          placeholder={"Family-run Italian restaurant in Camden.\nSeasonal dishes, handmade pasta and a warm welcome for friends and families."}
        />
        <p className="hint mt-1">
          Introduce your business to customers: what you offer and what makes it special. This description appears on your public page and helps your agent answer questions. Manage hours and contact options in <SectionLink id="business-information" className="text-accent underline">Details</SectionLink>.
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
    <div><label className="label" htmlFor="hours">Opening hours</label><AutoGrowTextarea id="hours" name="hours" className="input" minRows={2} maxRows={5} maxLength={500} defaultValue={hours} /></div>
    <div><label className="label" htmlFor="address">Business address</label><AutoGrowTextarea id="address" name="address" className="input" minRows={2} maxRows={5} maxLength={500} defaultValue={address} /></div>
    {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
    {state?.saved && <p role="status" className="text-sm text-accent">Saved. Your page and agent use these details.</p>}
    <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save business details"}</button>
  </form>;
}

type Source = { fromText: string | null; id: string; url: string; visibility: string; status: string; kind: string | null; error: string | null; last_read_at: string | null; words: number; preview: string; buttonLabel?: string };

const KIND: Record<string, string> = { page: "web page", pdf: "PDF", image: "photo", text: "text" };

/** Links your agent reads: website, PDF menu, menu photos. */
export function SourcesManager({ sources }: { sources: Source[] }) {
  const [buttonFor, setButtonFor] = useState<string | null>(null);
  const [buttonLabel, setButtonLabel] = useState("View document");
  const [includeButton, setIncludeButton] = useState(false);
  const [newButtonLabel, setNewButtonLabel] = useState("View menu");
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
          {sources.map((s) => (
            <li key={s.id} className="space-y-1 px-3 py-2.5" data-testid="business-source">
              <div className="flex flex-wrap items-center gap-2">
                <a href={s.url} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1 truncate text-sm font-medium text-accent hover:underline">
                  {s.url}
                </a>
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
              </div>
              <p className="text-xs" data-testid="source-status">
                {s.status === "ok" ? (
                  <span className="text-accent">
                    ✓ Read <LocalTime iso={s.last_read_at ?? new Date(0).toISOString()} /> · {KIND[s.kind ?? "page"] ?? "page"}
                  </span>
                ) : s.status === "error" ? (
                  <span className="text-danger">⚠️ Couldn&apos;t read it: {s.error}</span>
                ) : (
                  <span className="text-muted">⏳ Reading…</span>
                )}
                {s.fromText && (
                  <span className="text-muted" data-testid="source-from-text" title="This address is also written in your text above, so your agent can give it to customers too.">
                    {" "}· 📝 from your link in {s.fromText}
                  </span>
                )}
              </p>
              {s.preview && (
                <details>
                  <summary className="cursor-pointer text-xs text-muted">What your agent read</summary>
                  <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-accent-soft px-2 py-1 text-xs">{s.preview}</p>
                </details>
              )}
              <div className="flex gap-3 text-xs">
                {s.visibility === "public" && !s.buttonLabel && <button type="button" className="text-accent underline" onClick={() => { setButtonFor(s.id); setButtonLabel("View document"); }}>Create customer button</button>}
                <button type="button" className="text-accent underline" disabled={pending} onClick={() => act(() => rereadSourceAction(s.id))}>
                  Re-read now
                </button>
                <button type="button" className="text-muted underline" disabled={pending} onClick={() => act(() => removeSourceAction(s.id))}>
                  Remove
                </button>
              </div>
              {s.buttonLabel && <p className="hint">Customer button: {s.buttonLabel}. Edit it in <SectionLink id="book-or-order" className="text-accent underline">Details</SectionLink>.</p>}
              {buttonFor === s.id && <div className="flex gap-2"><input className="input" maxLength={60} aria-label="Document button label" value={buttonLabel} onChange={(e) => setButtonLabel(e.target.value)} /><button type="button" className="btn-primary" disabled={pending || !buttonLabel.trim()} onClick={() => act(async () => { const result = await createSourceButtonAction(s.id, buttonLabel); if (!result.error) setButtonFor(null); return result; })}>Add customer button</button></div>}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <input
          className="input min-w-0 flex-1"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-website.com/menu (page, PDF or photo)"
          aria-label="Link to read"
        />
        <select className="input w-auto" value={visibility} onChange={(e) => setVisibility(e.target.value)} aria-label="Visibility of the new link">
          <option value="public">Public</option>
          <option value="customers">Customers only</option>
        </select>
        <button
          type="button"
          className="btn-primary"
          disabled={pending || !url.trim() || (visibility === "public" && includeButton && !newButtonLabel.trim())}
          onClick={() =>
            act(async () => {
              const result = await addSourceAction(url, visibility, visibility === "public" && includeButton ? { buttonLabel: newButtonLabel } : undefined);
              if (!result.error) setUrl("");
              return result;
            })
          }
        >
          Add link
        </button>
      </div>
      {visibility === "public" && <div className="space-y-2"><label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={includeButton} onChange={(e) => setIncludeButton(e.target.checked)} />Also show customers a button for this document</label>{includeButton && <input className="input" aria-label="New document button label" maxLength={60} value={newButtonLabel} onChange={(e) => setNewButtonLabel(e.target.value)} />}</div>}
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <p className="hint">Add a web page, PDF or photo by its URL. Customers-only sources are used only in private replies to your contacts; changing a source to customers-only also removes its public customer buttons. Sources are checked approximately daily while AGENTME is running.</p>
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
