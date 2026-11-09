"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addChip, MAX_CUSTOM_TOPICS, type Topic } from "@/lib/profile/topics";
import { saveAwayAction, saveTopicAction } from "./actions";

/** A topic card; the open one stands out (accent border, raised, shadow), and only one is open at a time (same name). */
const CARD = "group rounded-2xl border border-border bg-surface transition-shadow open:border-accent/60 open:bg-raised open:shadow-2xl open:ring-1 open:ring-black/10";
const SECTION_TITLE = "text-xs font-semibold uppercase tracking-wide text-muted";

type Message = { ok: boolean; text: string } | null;

function useSaver() {
  const router = useRouter();
  const [message, setMessage] = useState<Message>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string }>, done = "Saved. Your agent uses this straight away.") =>
    start(async () => {
      const result = await fn();
      setMessage(result.error ? { ok: false, text: result.error } : { ok: true, text: done });
      if (!result.error) router.refresh();
    });
  return { message, pending, run };
}

// ------------------------------------------------------------- building blocks (one look for every card)

/** The closed row: icon, title, what's saved (or ＋ Add), who sees it, arrow. */
function CardSummary({ icon, title, value, share, accent }: { icon: string; title: string; /** What's saved ("" shows ＋ Add); leave out for no second line. */ value?: string; share: "👥" | "🔒" | null; accent?: string }) {
  return (
    <summary className="flex items-center gap-3 px-5 py-4 sm:px-6">
      <span className="text-xl" aria-hidden>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={`block text-sm font-semibold ${accent ?? ""}`}>{title}</span>
        {value !== undefined && <span className={`block truncate text-xs ${value ? "text-muted" : "text-accent"}`}>{value || "＋ Add"}</span>}
      </span>
      {share && <span title={share === "👥" ? "Shared with contacts' agents when asked" : "Only your agent"}>{share}</span>}
      <span className="text-muted transition group-open:rotate-90" aria-hidden>›</span>
    </summary>
  );
}

/** A labelled part of a card ("YOUR USUAL FREE TIMES", "WHO CAN SEE THIS"). */
function Section({ title, htmlFor, children }: { title: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      {htmlFor ? (
        <label className={SECTION_TITLE} htmlFor={htmlFor}>{title}</label>
      ) : (
        <p className={SECTION_TITLE}>{title}</p>
      )}
      {children}
    </div>
  );
}

/** The bar at the bottom: Remove (quiet, left), the result, Save (right). */
function CardFooter({ pending, message, onSave, saveLabel = "Save", onRemove, removeLabel = "Remove", saveDisabled, waiting }: {
  pending: boolean;
  message: Message;
  onSave: () => void;
  saveLabel?: string;
  onRemove?: () => void;
  removeLabel?: string;
  saveDisabled?: boolean;
  /** Shown instead of a result while Save can't be used yet ("Pick a date first."). */
  waiting?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-4 sm:px-6">
      {onRemove && (
        <button type="button" className="text-sm text-danger hover:underline" disabled={pending} onClick={onRemove}>
          {removeLabel}
        </button>
      )}
      <span className="min-w-0 flex-1 text-right">
        {message ? (
          <span className={`text-xs ${message.ok ? "text-accent" : "text-danger"}`} role={message.ok ? "status" : "alert"}>{message.text}</span>
        ) : (
          waiting && <span className="text-xs text-muted">{waiting}</span>
        )}
      </span>
      <button type="button" className="btn-primary px-6" disabled={pending || saveDisabled} onClick={onSave}>
        {pending ? "Saving…" : saveLabel}
      </button>
    </div>
  );
}

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

function Chips({ chips, title, onPick }: { chips: string[]; title: string; onPick: (chip: string) => void }) {
  if (!chips.length) return null;
  return (
    <div className="space-y-2 pt-1">
      <p className="text-xs text-muted">Quick add</p>
      <div className="flex flex-wrap gap-2" aria-label={`Quick picks for ${title}`}>
        {chips.map((chip) => (
          <button
            key={chip}
            type="button"
            className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium transition hover:border-accent hover:text-accent"
            onClick={() => onPick(chip)}
          >
            ＋ {chip}
          </button>
        ))}
      </div>
    </div>
  );
}

const TEXTAREA = "input min-h-24 px-4 py-3 text-[15px] leading-6";
const BODY = "space-y-6 border-t border-border px-5 py-5 sm:px-6";

// ------------------------------------------------------------- cards

/** What the text box holds, per topic. */
const SECTION_LABEL: Partial<Record<string, string>> = {
  availability: "Your usual free times",
  food: "What you like",
  interests: "What you're into",
  location: "Your area",
  budget: "Your usual budget",
  practical: "Things that matter for plans",
  notes: "Notes for your agent",
};

/** One topic: a summary line; tap to edit. */
export function TopicCard({
  topic,
  label,
  initialValue,
  initialShare,
}: {
  topic: Topic;
  /** Your own topic's name (built-in topics have none). */
  label?: string;
  initialValue: string;
  initialShare: boolean;
}) {
  const category = label ? "custom" : topic.key;
  const id = `value-${label ?? topic.key}`;
  const [value, setValue] = useState(initialValue);
  const [share, setShare] = useState(initialValue ? initialShare : topic.shareByDefault);
  const { message, pending, run } = useSaver();

  return (
    <details name="topics" className={CARD} data-testid={label ? "topic-custom" : `topic-${topic.key}`}>
      <CardSummary icon={topic.icon} title={topic.title} value={initialValue} share={initialValue ? (topic.alwaysPrivate || !initialShare ? "🔒" : "👥") : null} />
      <div className={BODY}>
        <p className="text-sm text-muted">{topic.hint}</p>
        <Section title={label ? "Details" : SECTION_LABEL[topic.key] ?? "Details"} htmlFor={id}>
          <textarea id={id} className={TEXTAREA} rows={3} maxLength={500} aria-label={topic.title} placeholder={topic.placeholder} value={value} onChange={(e) => setValue(e.target.value)} />
          <Chips chips={topic.chips} title={topic.title} onPick={(chip) => setValue((v) => addChip(v, chip))} />
        </Section>
        {topic.alwaysPrivate ? (
          <p className="rounded-xl bg-background px-4 py-3 text-sm text-muted">🔒 Always private: never given to any other agent.</p>
        ) : (
          <Section title="Who can see this">
            <ShareTiles share={share} onChange={setShare} name={`share-${label ?? topic.key}`} />
          </Section>
        )}
      </div>
      <CardFooter
        pending={pending}
        message={message}
        onSave={() => run(() => saveTopicAction({ category, label, value, share }))}
        onRemove={initialValue ? () => run(() => saveTopicAction({ category, label, value: "", share: false }), "Removed.") : undefined}
        removeLabel={label ? "Delete this topic" : "Remove"}
      />
    </details>
  );
}

/** ✈️ Away for a while: its own row, like every topic (part of "when you're free", forgotten after that day). */
export function AwayCard({ current, currentShare, minDate }: { current: { until: string; text: string } | null; currentShare: boolean; minDate: string }) {
  const [until, setUntil] = useState(current?.until ?? "");
  const [note, setNote] = useState(current?.text.match(/\(([^)]*)\)/)?.[1] ?? "");
  const [share, setShare] = useState(current ? currentShare : true);
  const { message, pending, run } = useSaver();
  const summary = current?.text.split(":")[0] ?? "";
  return (
    <details name="topics" className={CARD} data-testid="topic-away">
      <CardSummary icon="✈️" title="Away for a while" value={summary} share={summary ? (currentShare ? "👥" : "🔒") : null} />
      <div className={BODY}>
        <p className="text-sm text-muted">Holidays, trips, busy weeks: plans before that day won&apos;t include you. It&apos;s forgotten by itself after that day.</p>
        <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
          <Section title="Away until" htmlFor="away-until">
            <input id="away-until" type="date" className="input w-auto px-4 py-2.5" min={minDate} value={until} onChange={(e) => setUntil(e.target.value)} />
          </Section>
          <Section title="Note (optional)" htmlFor="away-note">
            <input id="away-note" className="input px-4 py-2.5" aria-label="Away note" placeholder="e.g. holiday" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          </Section>
        </div>
        <Section title="Who can see this">
          <ShareTiles share={share} onChange={setShare} name="share-away" />
        </Section>
      </div>
      <CardFooter
        pending={pending}
        message={message}
        saveDisabled={!until}
        waiting={until ? undefined : "Pick a date first."}
        onSave={() => run(() => saveAwayAction({ until, note, share }))}
        onRemove={
          current
            ? () => {
                setUntil("");
                setNote("");
                run(() => saveAwayAction({ until: "", note: "", share: false }), "Removed.");
              }
            : undefined
        }
      />
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
          <CardSummary icon="✨" title="＋ Your own topic" share={null} accent="text-accent" />
          <div className={BODY}>
            <p className="text-sm text-muted">Anything your agent should know, under a name you choose.</p>
            <Section title="Name" htmlFor="own-topic-name">
              <input id="own-topic-name" className="input px-4 py-2.5" aria-label="Topic name" placeholder="e.g. Music I like" maxLength={40} value={label} onChange={(e) => setLabel(e.target.value)} />
            </Section>
            <Section title="Details" htmlFor="own-topic-details">
              <textarea id="own-topic-details" className={TEXTAREA} rows={3} aria-label="Topic details" placeholder="e.g. Jazz, 90s hip hop, anything live" maxLength={500} value={value} onChange={(e) => setValue(e.target.value)} />
            </Section>
            <Section title="Who can see this">
              <ShareTiles share={share} onChange={setShare} name="share-new-topic" />
            </Section>
          </div>
          <CardFooter
            pending={pending}
            message={message}
            saveLabel="Add topic"
            saveDisabled={!label.trim() || !value.trim()}
            onSave={() =>
              run(async () => {
                const result = await saveTopicAction({ category: "custom", label, value, share });
                if (!result.error) {
                  setLabel("");
                  setValue("");
                }
                return result;
              }, "Added.")
            }
          />
        </details>
      )}
    </div>
  );
}
