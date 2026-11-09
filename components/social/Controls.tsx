"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShareLink } from "@/app/(app)/contacts/ShareLink";
import { ContactSearch } from "./ContactSearch";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";

type Out = { error?: string } | undefined | void;

/** Emoji choice for a group or community (submitted as "avatar"). */
export function AvatarPicker({ options, initial }: { options: string[]; initial?: string | null }) {
  const [value, setValue] = useState(initial && options.includes(initial) ? initial : options[0]);
  return (
    <div>
      <input type="hidden" name="avatar" value={value} />
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Picture">
        {options.map((a) => (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={value === a}
            onClick={() => setValue(a)}
            className={`rounded-xl px-2 py-1 text-2xl ${value === a ? "bg-accent-soft ring-2 ring-accent" : ""}`}
          >
            {a}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A button that asks "are you sure?" first, then runs the action. */
export function ConfirmButton({ action, label, question, variant = "btn-danger" }: { action: () => Promise<Out>; label: string; question: string; variant?: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        className={variant}
        disabled={pending}
        onClick={() => {
          if (!window.confirm(question)) return;
          start(async () => {
            const result = await action();
            if (result && result.error) setError(result.error);
          });
        }}
      >
        {pending ? "…" : label}
      </button>
      {error && <span className="text-xs text-danger" role="alert">{error}</span>}
    </span>
  );
}

/** Admins/moderators: an invite link they share themselves, which they can turn off. */
export function JoinLinkBox({ create, revoke, what }: { create: () => Promise<{ url?: string; error?: string }>; revoke: () => Promise<Out>; what: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!url) {
    return (
      <div className="space-y-1">
        <button
          type="button"
          className="btn-ghost"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await create();
              if (result.error) setMessage(result.error);
              else setUrl(result.url ?? null);
            })
          }
        >
          🔗 Invite link
        </button>
        {message && <p className="text-xs text-muted">{message}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-2" data-testid="join-link">
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-accent-soft px-2 py-1.5 text-xs" data-testid="join-url">{url}</code>
        <ShareLink url={url} text={`Join ${what} on AGENTME`} label="Share" />
      </div>
      <button
        type="button"
        className="text-xs text-danger underline"
        onClick={() =>
          start(async () => {
            await revoke();
            setUrl(null);
            setMessage("Link turned off. People who already joined stay.");
          })
        }
      >
        Turn off link
      </button>
    </div>
  );
}

/** "Report" with a short reason; optionally also leave (and block). */
export function ReportForm({ action, withLeave, label = "Report" }: { action: (reason: string, leave: boolean) => Promise<Out>; withLeave?: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [leave, setLeave] = useState(true);
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (!open) {
    return (
      <button type="button" className="btn-ghost" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }
  return (
    <div className="w-full space-y-2 rounded-xl border border-border p-3">
      <AutoGrowTextarea className="input" minRows={2} maxRows={5} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What's wrong? (spam, abuse, …)" aria-label="Reason" />
      {withLeave && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={leave} onChange={(e) => setLeave(e.target.checked)} /> Also leave and block this group
        </label>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-danger"
          disabled={pending || !reason.trim()}
          onClick={() =>
            start(async () => {
              const result = await action(reason, Boolean(withLeave && leave));
              setState(result && result.error ? { ok: false, text: result.error } : { ok: true, text: "Thanks, reported." });
            })
          }
        >
          Send report
        </button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {state && <p className={`text-sm ${state.ok ? "text-muted" : "text-danger"}`} role={state.ok ? "status" : "alert"}>{state.text}</p>}
    </div>
  );
}

type Person = { id: string; avatar: string; display_name: string; handle: string };

/** Find contacts by name or @handle, pick them, then add them all at once. */
export function MemberPicker({ people, action, button = "Add to group" }: { people: Person[]; action: (ids: string[]) => Promise<{ error?: string; note?: string }>; button?: string }) {
  const router = useRouter();
  const [round, setRound] = useState(0); // remounts the search (clears the chips) after adding
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (!people.length) return <p className="text-sm text-muted">All your contacts are already here.</p>;
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        const ids = new FormData(e.currentTarget).getAll("members").map(String);
        if (!ids.length) {
          setMessage({ ok: false, text: "Search and pick someone first." });
          return;
        }
        start(async () => {
          const result = await action(ids);
          setRound((r) => r + 1);
          setMessage(result.error ? { ok: false, text: result.error } : { ok: true, text: result.note || "Done." });
          router.refresh();
        });
      }}
    >
      <ContactSearch key={round} contacts={people} />
      <button className="btn-primary" disabled={pending}>{pending ? "Adding…" : button}</button>
      {message && <p className={`text-sm ${message.ok ? "text-muted" : "text-danger"}`} role="status">{message.text}</p>}
    </form>
  );
}
