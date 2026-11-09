"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addChip, MAX_CUSTOM_TOPICS, type Topic } from "@/lib/profile/topics";
import { saveAwayAction, saveTopicAction } from "./actions";

/** A topic card; the open one stands out (accent border, raised, shadow), and only one is open at a time (same name). */
const CARD = "group rounded-2xl border border-border bg-surface transition-shadow open:border-accent/60 open:bg-raised open:shadow-2xl open:ring-1 open:ring-black/10";

function ShareChoice({ share, onChange, name }: { share: boolean; onChange: (share: boolean) => void; name: string }) {
  return (
    <fieldset className="space-y-1">
      <legend className="sr-only">Who can see this</legend>
      {[
        [false, "🔒 Only my agent", "Used for your own plans, never given to anyone."],
        [true, "👥 My contacts' agents", "Only when a contact's plan asks for this kind of thing."],
      ].map(([value, label, hint]) => (
        <label key={String(value)} className="flex items-start gap-2 text-sm">
          <input type="radio" name={name} className="mt-1" checked={share === value} onChange={() => onChange(value as boolean)} />
          <span>
            {label as string}
            <span className="block text-xs text-muted">{hint as string}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function useSaver() {
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string }>, done = "Saved. Your agent uses this straight away.") =>
    start(async () => {
      const result = await fn();
      setMessage(result.error ? { ok: false, text: result.error } : { ok: true, text: done });
      if (!result.error) router.refresh();
    });
  return { message, pending, run };
}

/** One topic: a summary line; tap to edit. */
export function TopicCard({
  topic,
  label,
  initialValue,
  initialShare,
  spacious = false,
  children,
}: {
  topic: Topic;
  /** Your own topic's name (built-in topics have none). */
  label?: string;
  initialValue: string;
  initialShare: boolean;
  /** The roomier layout (being trialled on one card). */
  spacious?: boolean;
  children?: React.ReactNode;
}) {
  const category = label ? "custom" : topic.key;
  const [value, setValue] = useState(initialValue);
  const [share, setShare] = useState(initialValue ? initialShare : topic.shareByDefault);
  const { message, pending, run } = useSaver();
  const shown = initialValue ? (topic.alwaysPrivate || !initialShare ? "🔒" : "👥") : null;

  return (
    <details name="topics" className={CARD} data-testid={label ? "topic-custom" : `topic-${topic.key}`}>
      <summary className={`flex items-center gap-3 ${spacious ? "px-5 py-4 sm:px-6" : "px-4 py-3"}`}>
        <span className="text-xl" aria-hidden>{topic.icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{topic.title}</span>
          <span className={`block truncate text-xs ${initialValue ? "text-muted" : "text-accent"}`}>{initialValue || "＋ Add"}</span>
        </span>
        {shown && <span title={shown === "👥" ? "Shared with contacts' agents when asked" : "Only your agent"}>{shown}</span>}
        <span className="text-muted transition group-open:rotate-90" aria-hidden>›</span>
      </summary>
      {spacious ? (
        <div className="border-t border-border">
          <div className="space-y-6 px-5 py-5 sm:px-6">
            <p className="text-sm text-muted">{topic.hint}</p>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted" htmlFor={`value-${label ?? topic.key}`}>
                {SECTION_LABEL[topic.key] ?? "Details"}
              </label>
              <textarea
                id={`value-${label ?? topic.key}`}
                className="input min-h-24 px-4 py-3 text-[15px] leading-6"
                rows={3}
                maxLength={500}
                aria-label={topic.title}
                placeholder={topic.placeholder}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
              {topic.chips.length > 0 && (
                <div className="space-y-2 pt-1">
                  <p className="text-xs text-muted">Quick add</p>
                  <div className="flex flex-wrap gap-2" aria-label={`Quick picks for ${topic.title}`}>
                    {topic.chips.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium transition hover:border-accent hover:text-accent"
                        onClick={() => setValue((v) => addChip(v, chip))}
                      >
                        ＋ {chip}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {topic.alwaysPrivate ? (
              <p className="rounded-xl bg-background px-4 py-3 text-sm text-muted">🔒 Always private: never given to any other agent.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Who can see this</p>
                <ShareTiles share={share} onChange={setShare} name={`share-${label ?? topic.key}`} />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-4 sm:px-6">
            {initialValue && (
              <button
                type="button"
                className="text-sm text-danger hover:underline"
                disabled={pending}
                onClick={() => run(() => saveTopicAction({ category, label, value: "", share: false }), "Removed.")}
              >
                {label ? "Delete this topic" : "Remove"}
              </button>
            )}
            <span className="min-w-0 flex-1 text-right">
              {message && <span className={`text-xs ${message.ok ? "text-accent" : "text-danger"}`} role={message.ok ? "status" : "alert"}>{message.text}</span>}
            </span>
            <button type="button" className="btn-primary px-6" disabled={pending} onClick={() => run(() => saveTopicAction({ category, label, value, share }))}>
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
          {children}
        </div>
      ) : (
      <div className="space-y-3 border-t border-border px-4 py-3">
        <p className="hint">{topic.hint}</p>
        <textarea
          className="input"
          rows={2}
          maxLength={500}
          aria-label={topic.title}
          placeholder={topic.placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        {topic.chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label={`Quick picks for ${topic.title}`}>
            {topic.chips.map((chip) => (
              <button key={chip} type="button" className="rounded-full border border-border px-2.5 py-0.5 text-xs hover:bg-accent-soft" onClick={() => setValue((v) => addChip(v, chip))}>
                ＋ {chip}
              </button>
            ))}
          </div>
        )}
        {topic.alwaysPrivate ? (
          <p className="hint">🔒 Always private: never given to any other agent.</p>
        ) : (
          <ShareChoice share={share} onChange={setShare} name={`share-${label ?? topic.key}`} />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary" disabled={pending} onClick={() => run(() => saveTopicAction({ category, label, value, share }))}>
            Save
          </button>
          {initialValue && (
            <button type="button" className="btn-ghost" disabled={pending} onClick={() => run(() => saveTopicAction({ category, label, value: "", share: false }), "Removed.")}>
              {label ? "Delete this topic" : "Remove"}
            </button>
          )}
          {message && <span className={`text-xs ${message.ok ? "text-accent" : "text-danger"}`} role={message.ok ? "status" : "alert"}>{message.text}</span>}
        </div>
        {children}
      </div>
      )}
    </details>
  );
}

/** What the text box holds, per topic (the redesigned card). */
const SECTION_LABEL: Partial<Record<string, string>> = {
  availability: "Your usual free times",
  food: "What you like",
  interests: "What you're into",
  location: "Your area",
  budget: "Your usual budget",
  practical: "Things that matter for plans",
  notes: "Notes for your agent",
};

/** Sharing as two choice tiles (side by side; stacked on a phone). */
function ShareTiles({ share, onChange, name }: { share: boolean; onChange: (share: boolean) => void; name: string }) {
  const options: [boolean, string, string, string][] = [
    [false, "🔒", "Only my agent", "Used for your own plans, never given to anyone."],
    [true, "👥", "My contacts' agents", "Only when a contact's plan asks for this kind of thing."],
  ];
  return (
    <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Who can see this">
      {options.map(([value, icon, title, hint]) => (
        <label
          key={String(value)}
          className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
            share === value ? "border-accent bg-accent-soft" : "border-border bg-background hover:border-muted"
          }`}
        >
          <input type="radio" name={name} className="sr-only" checked={share === value} onChange={() => onChange(value)} />
          <span className="text-lg" aria-hidden>{icon}</span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">{title}</span>
            <span className="block text-xs text-muted">{hint}</span>
          </span>
          <span className={`ml-auto mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${share === value ? "border-accent bg-accent" : "border-border"}`} aria-hidden />
        </label>
      ))}
    </div>
  );
}

/** ✈️ Away for a while: its own row, like every topic (part of "when you're free", forgotten after that day). */
export function AwayCard({ current, currentShare, minDate }: { current: { until: string; text: string } | null; currentShare: boolean; minDate: string }) {
  const [until, setUntil] = useState(current?.until ?? "");
  const [note, setNote] = useState(current?.text.match(/\(([^)]*)\)/)?.[1] ?? "");
  const [share, setShare] = useState(current ? currentShare : true);
  const { message, pending, run } = useSaver();
  const summary = current?.text.split(":")[0] ?? null;
  return (
    <details name="topics" className={CARD} data-testid="topic-away">
      <summary className="flex items-center gap-3 px-4 py-3">
        <span className="text-xl" aria-hidden>✈️</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Away for a while</span>
          <span className={`block truncate text-xs ${summary ? "text-muted" : "text-accent"}`}>{summary || "＋ Add"}</span>
        </span>
        {summary && <span title={currentShare ? "Shared with contacts' agents when asked" : "Only your agent"}>{currentShare ? "👥" : "🔒"}</span>}
        <span className="text-muted transition group-open:rotate-90" aria-hidden>›</span>
      </summary>
      <div className="space-y-3 border-t border-border px-4 py-3">
        <p className="hint">Holidays, trips, busy weeks: plans before that day won&apos;t include you. It&apos;s forgotten by itself after that day.</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm" htmlFor="away-until">Away until</label>
          <input id="away-until" type="date" className="input w-auto" min={minDate} value={until} onChange={(e) => setUntil(e.target.value)} />
          <input className="input min-w-0 flex-1" aria-label="Away note" placeholder="optional, e.g. holiday" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <ShareChoice share={share} onChange={setShare} name="share-away" />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-primary"
            disabled={pending}
            onClick={() => (until ? run(() => saveAwayAction({ until, note, share })) : undefined)}
            title={until ? undefined : "Pick a date first"}
          >
            Save
          </button>
          {current && (
            <button
              type="button"
              className="btn-ghost"
              disabled={pending}
              onClick={() => {
                setUntil("");
                setNote("");
                run(() => saveAwayAction({ until: "", note: "", share: false }), "Removed.");
              }}
            >
              Remove
            </button>
          )}
          {!until && !message && <span className="text-xs text-muted">Pick a date first.</span>}
          {message && <span className={`text-xs ${message.ok ? "text-accent" : "text-danger"}`} role={message.ok ? "status" : "alert"}>{message.text}</span>}
        </div>
      </div>
    </details>
  );
}

/** Your own topics: name them, fill them in, choose who sees them. */
export function CustomTopics({ topics }: { topics: { label: string; value: string; share: boolean }[] }) {
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [share, setShare] = useState(true);
  const { message, pending, run } = useSaver();
  return (
    <div className="space-y-2">
      {topics.map((t) => (
        <TopicCard
          key={t.label}
          topic={{ key: "interests", icon: "✨", title: t.label, hint: "Your own topic. Shared, it's given when a contact's plan asks about your interests.", placeholder: "", chips: [], shareByDefault: true }}
          label={t.label}
          initialValue={t.value}
          initialShare={t.share}
        />
      ))}
      {topics.length < MAX_CUSTOM_TOPICS && (
        <details name="topics" className={`${CARD} border-dashed`} data-testid="add-own-topic">
          <summary className="px-4 py-3 text-sm font-medium text-accent">＋ Your own topic</summary>
          <div className="space-y-2 border-t border-border px-4 py-3">
            <input className="input" aria-label="Topic name" placeholder="Name, e.g. Music I like" maxLength={40} value={label} onChange={(e) => setLabel(e.target.value)} />
            <textarea className="input" rows={2} aria-label="Topic details" placeholder="e.g. Jazz, 90s hip hop, anything live" maxLength={500} value={value} onChange={(e) => setValue(e.target.value)} />
            <ShareChoice share={share} onChange={setShare} name="share-new-topic" />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn-primary"
                disabled={pending || !label.trim() || !value.trim()}
                onClick={() =>
                  run(async () => {
                    const result = await saveTopicAction({ category: "custom", label, value, share });
                    if (!result.error) {
                      setLabel("");
                      setValue("");
                    }
                    return result;
                  }, "Added.")
                }
              >
                Add topic
              </button>
              {message && <span className={`text-xs ${message.ok ? "text-accent" : "text-danger"}`} role={message.ok ? "status" : "alert"}>{message.text}</span>}
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
