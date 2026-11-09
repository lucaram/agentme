"use client";

import Link from "next/link";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";
import { BASICS, itemKey, tryQuestions, type BasicKey, type Correction, type Learned } from "@/lib/business/learn";
import { shortUrl } from "@/lib/business/site";
import {
  fixLearnedAction,
  goLiveAction,
  hideLearnedAction,
  previewAnswerAction,
  removeCorrectionAction,
  rereadWebsiteAction,
  siteStatusAction,
} from "../website-actions";

type Progress = { status: string; pagesRead: number; pagesFound: number; progress: { title: string; url: string }[]; error: string | null };
type Site = Progress & { domain: string; url: string; warning: string | null; live: boolean; verified: boolean };

const STEP = "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white dark:text-black";

export function SiteSetup({ name, site, learned, hidden, corrections }: { name: string; site: Site; learned: Learned; hidden: string[]; corrections: Correction[] }) {
  const router = useRouter();
  const [polled, setPolled] = useState<Progress | null>(null);

  // While reading: live progress, then the page reloads with what was learned.
  useEffect(() => {
    if (site.status !== "reading") return;
    let live = true;
    const timer = setInterval(async () => {
      const s = await siteStatusAction().catch(() => null);
      if (!live || !s) return;
      setPolled(s);
      if (s.status !== "reading") {
        clearInterval(timer);
        router.refresh();
      }
    }, 1500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [site.status, router]);

  const now = site.status === "reading" && polled ? { ...site, ...polled } : site;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link href="/business" className="text-sm text-accent hover:underline">‹ My Business</Link>
        <h1 className="text-lg font-semibold">{now.status === "ready" ? `Your agent learned ${site.domain}` : `Your agent is reading ${site.domain}`}</h1>
        <p className="text-xs text-muted">
          {site.live
            ? `✓ Live: ${name}'s agent answers customers from your website and re-reads it every day.`
            : "Check what it learned, try it as a customer, then go live. Nothing is used with customers until you press Go live."}
        </p>
      </div>

      {now.status === "reading" && <Reading site={now} />}
      {now.status === "error" && <ReadError message={now.error ?? "Couldn't read your website."} />}
      {now.status === "ready" && (
        <>
          {site.warning && (
            <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm" role="status" data-testid="site-warning">
              ⚠️ {site.warning}
            </p>
          )}
          <section className="card space-y-4" aria-label="What your agent learned" data-testid="learned">
            <h2 className="flex items-center gap-2 font-semibold">
              <span className={STEP}>1</span> What your agent learned
            </h2>
            <p className="hint -mt-2">
              From {site.pagesRead} {site.pagesRead === 1 ? "page" : "pages"} of your website. Tap ✏️ to fix anything that&apos;s wrong (your fix beats the website) or ✕ to leave it out.
            </p>
            <LearnedList learned={learned} hidden={hidden} corrections={corrections} />
          </section>

          <section className="card space-y-3" aria-label="Try it as a customer">
            <h2 className="flex items-center gap-2 font-semibold">
              <span className={STEP}>2</span> Try it as a customer
            </h2>
            <p className="hint -mt-1">What customers&apos; agents will be told, with the page each answer comes from.</p>
            <TryAsCustomer questions={tryQuestions(withoutHidden(learned, hidden))} />
          </section>

          <section className="card space-y-3" aria-label="Go live">
            <h2 className="flex items-center gap-2 font-semibold">
              <span className={STEP}>3</span> {site.live ? "You're live" : "Go live"}
            </h2>
            {site.live ? (
              <>
                <p className="text-sm">Your agent answers from your website, and re-reads it every day. When something changes, you&apos;ll see it in My Business.</p>
                <Link href="/business" className="btn-primary w-full">Back to My Business</Link>
              </>
            ) : (
              <GoLive />
            )}
          </section>
        </>
      )}
    </div>
  );
}

const withoutHidden = (learned: Learned, hidden: string[]): Learned => ({ ...learned, faqs: learned.faqs.filter((f) => !hidden.includes(itemKey.faq(f.q))) });

function Reading({ site }: { site: Progress & { domain: string } }) {
  const total = Math.max(site.pagesFound, site.pagesRead, 1);
  const pct = Math.min(100, Math.round((site.pagesRead / total) * 100));
  return (
    <section className="card space-y-3" aria-label="Reading your website" data-testid="site-reading">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-accent" aria-hidden />
        <span className="font-medium">Reading {site.domain}…</span>
        <span className="ml-auto text-xs tabular-nums text-muted" aria-live="polite">
          {site.pagesRead} {site.pagesFound > site.pagesRead ? `of ${site.pagesFound} ` : ""}pages
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-border" aria-hidden>
        <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${Math.max(pct, 8)}%` }} />
      </div>
      <ul className="space-y-1 text-sm" aria-label="Pages read">
        {site.progress.slice(-8).map((p) => (
          <li key={p.url} className="flex items-center gap-2">
            <span className="text-accent" aria-hidden>✓</span>
            <span className="truncate">{p.title}</span>
          </li>
        ))}
      </ul>
      <p className="hint">This takes under a minute. You can leave this page: your agent keeps reading.</p>
    </section>
  );
}

function ReadError({ message }: { message: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className="card space-y-3 border-danger" role="alert">
      <p className="text-sm">{message}</p>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await rereadWebsiteAction();
              if (r.error) setError(r.error);
              else router.refresh();
            })
          }
        >
          {pending ? "Starting…" : "Try again"}
        </button>
        <Link href="/business" className="btn-ghost">Set it up by hand instead</Link>
      </div>
    </section>
  );
}

/** Runs an action, then reloads the page data (or shows the error). */
function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ error?: string }>, done?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.error) setError(r.error);
      else {
        done?.();
        router.refresh();
      }
    });
  return { pending, error, run };
}

function LearnedList({ learned, hidden, corrections }: { learned: Learned; hidden: string[]; corrections: Correction[] }) {
  const basics = BASICS.filter((b) => learned[b.key]);
  const nothing = !basics.length && !learned.facts.length && !learned.faqs.length;
  if (nothing) {
    return (
      <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm">
        Your agent didn&apos;t find much it could use on your website. It still answers from the pages it read; you can add your own words, a PDF menu or questions & answers in My Business.
      </p>
    );
  }
  const fixed = (label: string) => corrections.find((c) => c.label.toLowerCase() === label.toLowerCase());
  return (
    <div className="space-y-5">
      {basics.length > 0 && (
        <Group title="The basics">
          {basics.map((b) => (
            <Item
              key={b.key}
              testId="learned-basic"
              title={b.label}
              text={learned[b.key]}
              hiddenKey={itemKey.basic(b.key)}
              hidden={hidden.includes(itemKey.basic(b.key))}
              correction={fixed(b.label)}
              fix={{ kind: "basic", key: b.key as BasicKey }}
            />
          ))}
        </Group>
      )}
      {learned.facts.length > 0 && (
        <Group title="What customers ask about">
          {learned.facts.map((f) => (
            <Item
              key={f.label}
              testId="learned-fact"
              title={f.label}
              text={f.value}
              source={f.source}
              hiddenKey={itemKey.fact(f.label)}
              hidden={hidden.includes(itemKey.fact(f.label))}
              correction={fixed(f.label)}
              fix={{ kind: "fact", label: f.label }}
            />
          ))}
        </Group>
      )}
      {learned.faqs.length > 0 && (
        <Group title="Questions & answers, ready-made">
          {learned.faqs.map((f) => (
            <FaqItem key={f.q} q={f.q} a={f.a} source={f.source} hidden={hidden.includes(itemKey.faq(f.q))} />
          ))}
        </Group>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <ul className="divide-y divide-border rounded-xl border border-border">{children}</ul>
    </div>
  );
}

function Source({ url }: { url?: string }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="text-xs text-muted underline-offset-2 hover:underline">
      📄 {shortUrl(url)}
    </a>
  );
}

type FixTarget = { kind: "basic"; key: BasicKey } | { kind: "fact"; label: string };

/** One learned basic or fact: ✏️ fix (becomes a correction) or ✕ leave out; fixed or removed ones can be undone. */
function Item({ testId, title, text, source, hiddenKey, hidden, correction, fix }: { testId: string; title: string; text: string; source?: string; hiddenKey: string; hidden: boolean; correction?: Correction; fix: FixTarget }) {
  const { pending, error, run } = useRun();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(correction?.value ?? text);
  const save = () =>
    run(() => fixLearnedAction(fix.kind === "basic" ? { kind: "basic", key: fix.key, value } : { kind: "fact", label: fix.label, value }), () => setEditing(false));

  return (
    <li className="space-y-1.5 px-3 py-2.5" data-testid={testId}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted">{title}</p>
          {editing ? (
            <AutoGrowTextarea className="input mt-1" minRows={1} maxRows={6} maxLength={400} value={value} onChange={(e) => setValue(e.target.value)} aria-label={`Fix ${title}`} autoFocus />
          ) : correction ? (
            <p className="text-sm">
              {correction.value} <span className="ml-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">✏️ fixed by you</span>
            </p>
          ) : (
            <p className={`text-sm ${hidden ? "text-muted line-through" : ""}`}>{text}</p>
          )}
          {!editing && !correction && <Source url={source} />}
        </div>
        {!editing && (
          <div className="flex shrink-0 gap-1">
            {correction ? (
              <button type="button" className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-accent-soft" disabled={pending} onClick={() => run(async () => (await removeCorrectionAction(correction.label)).error ? { error: "Couldn't undo." } : hideLearnedAction(hiddenKey, false))}>
                ↩ Use the website&apos;s
              </button>
            ) : hidden ? (
              <button type="button" className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-accent-soft" disabled={pending} onClick={() => run(() => hideLearnedAction(hiddenKey, false))}>
                ↩ Undo
              </button>
            ) : (
              <>
                <button type="button" className="rounded-lg px-2 py-1 text-sm hover:bg-accent-soft" aria-label={`Fix ${title}`} title="Fix" onClick={() => setEditing(true)}>✏️</button>
                <button type="button" className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-accent-soft" aria-label={`Leave out ${title}`} title="Leave out" disabled={pending} onClick={() => run(() => hideLearnedAction(hiddenKey, true))}>✕</button>
              </>
            )}
          </div>
        )}
      </div>
      {editing && (
        <div className="flex gap-2">
          <button type="button" className="btn-primary px-4 py-1.5" disabled={pending || !value.trim()} onClick={save}>{pending ? "Saving…" : "Save fix"}</button>
          <button type="button" className="btn-ghost px-4 py-1.5" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      )}
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
    </li>
  );
}

/** A ready-made question: ✏️ fix (becomes one of your own Questions & answers) or ✕ leave out. */
function FaqItem({ q, a, source, hidden }: { q: string; a: string; source?: string; hidden: boolean }) {
  const { pending, error, run } = useRun();
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState(q);
  const [answer, setAnswer] = useState(a);
  return (
    <li className="space-y-1.5 px-3 py-2.5" data-testid="learned-faq">
      <div className="flex items-start gap-2">
        <div className={`min-w-0 flex-1 ${hidden ? "text-muted" : ""}`}>
          {editing ? (
            <div className="space-y-2">
              <input className="input" value={question} maxLength={300} onChange={(e) => setQuestion(e.target.value)} aria-label="Question" />
              <AutoGrowTextarea className="input" minRows={2} maxRows={6} maxLength={1000} value={answer} onChange={(e) => setAnswer(e.target.value)} aria-label="Answer" />
            </div>
          ) : (
            <>
              <p className={`text-sm font-medium ${hidden ? "line-through" : ""}`}>{q}</p>
              <p className={`text-sm ${hidden ? "line-through" : ""}`}>{a}</p>
              {hidden ? <p className="text-xs">Left out. If you fixed it, your version is in Questions &amp; answers.</p> : <Source url={source} />}
            </>
          )}
        </div>
        {!editing && (
          <div className="flex shrink-0 gap-1">
            {hidden ? (
              <button type="button" className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-accent-soft" disabled={pending} onClick={() => run(() => hideLearnedAction(itemKey.faq(q), false))}>
                ↩ Undo
              </button>
            ) : (
              <>
                <button type="button" className="rounded-lg px-2 py-1 text-sm hover:bg-accent-soft" aria-label={`Fix “${q}”`} title="Fix" onClick={() => setEditing(true)}>✏️</button>
                <button type="button" className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-accent-soft" aria-label={`Leave out “${q}”`} title="Leave out" disabled={pending} onClick={() => run(() => hideLearnedAction(itemKey.faq(q), true))}>✕</button>
              </>
            )}
          </div>
        )}
      </div>
      {editing && (
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-primary px-4 py-1.5"
            disabled={pending || !question.trim() || !answer.trim()}
            onClick={() => run(() => fixLearnedAction({ kind: "faq", original: q, q: question, a: answer }), () => setEditing(false))}
          >
            {pending ? "Saving…" : "Save fix"}
          </button>
          <button type="button" className="btn-ghost px-4 py-1.5" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      )}
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
    </li>
  );
}

type Answer = { answer: string; needsTeam?: boolean; failed?: boolean };

/** Three likely questions, asked straight away, plus your own. */
function TryAsCustomer({ questions }: { questions: string[] }) {
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [asked, setAsked] = useState<string[]>([]);
  const [text, setText] = useState("");
  const key = questions.join("\n");

  useEffect(() => {
    let live = true;
    for (const q of key.split("\n").filter(Boolean)) {
      void previewAnswerAction(q).then((r) => {
        if (live) setAnswers((a) => ({ ...a, [q]: r.error ? { answer: r.error, failed: true } : { answer: r.answer ?? "", needsTeam: r.needsTeam } }));
      });
    }
    return () => {
      live = false;
    };
  }, [key]);

  const ask = (q: string) => {
    const question = q.trim();
    if (!question) return;
    setAsked((list) => [...list.filter((x) => x !== question), question]);
    setAnswers((a) => {
      const rest = { ...a };
      delete rest[question];
      return rest;
    });
    setText("");
    void previewAnswerAction(question).then((r) => setAnswers((a) => ({ ...a, [question]: r.error ? { answer: r.error, failed: true } : { answer: r.answer ?? "", needsTeam: r.needsTeam } })));
  };

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {[...questions, ...asked.filter((q) => !questions.includes(q))].map((q) => (
          <li key={q} className="space-y-1.5" data-testid="try-customer">
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl bg-accent px-3 py-2 text-sm text-white dark:text-black">{q}</p>
            {answers[q] ? (
              <div className={`w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl border px-3 py-2 text-sm ${answers[q].failed ? "border-danger text-danger" : "border-agent-border bg-agent"}`}>
                <span className="mr-1 rounded bg-agent-border px-1 text-[10px] font-semibold uppercase">AI</span>
                {answers[q].answer}
                {answers[q].needsTeam && <span className="mt-1 block text-xs text-muted">Not on your website: your agent would ask you, and you&apos;d see it in My Business.</span>}
              </div>
            ) : (
              <p className="text-xs text-muted" aria-live="polite">Your agent is answering…</p>
            )}
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask(text);
        }}
      >
        <input className="input" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder="Ask your own question, e.g. Do you have vegan options?" aria-label="Your own question" />
        <button className="btn-ghost shrink-0" disabled={!text.trim()}>Ask</button>
      </form>
    </div>
  );
}

function GoLive() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <p className="text-sm">Customers&apos; agents will get answers from your website, with the page each answer came from. Your agent still never books, orders or takes payments.</p>
      <button
        type="button"
        className="btn-primary w-full py-3 text-base"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await goLiveAction();
            if (r.error) setError(r.error);
            else router.push("/business?live=1");
          })
        }
      >
        {pending ? "Going live…" : "🚀 Go live"}
      </button>
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
    </div>
  );
}
