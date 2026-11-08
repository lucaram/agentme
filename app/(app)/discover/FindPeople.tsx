"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clearContactsAction, syncContactsAction } from "../people-actions";
import { extractEntries } from "@/lib/people/normalise";
import { detectCountryCode } from "@/lib/people/country";
import { LocalTime } from "@/components/LocalTime";

type Mode = "real" | "simulated" | "off";
type Sources = Partial<Record<"google" | "microsoft" | "phone" | "typed", string>>;
type ContactsManager = { select: (props: string[], opts: { multiple: boolean }) => Promise<{ email?: string[]; tel?: string[] }[]> };

const noop = () => () => {};

function Option({ icon, title, text, synced, children }: { icon: string; title: string; text: string; synced?: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
      <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xl">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-muted">{text}</span>
        {synced && (
          <span className="mt-0.5 block text-xs text-accent">
            ✓ Synced <LocalTime iso={synced} />
          </span>
        )}
      </span>
      <span className="flex flex-wrap gap-2">{children}</span>
    </li>
  );
}

/**
 * Find people you know, three ways: email contacts (Gmail / Outlook), phone
 * contacts, or typed in. Only people who also have you show up; the contacts
 * themselves are compared and forgotten.
 */
export function FindPeople({
  sources,
  providers,
  preferred,
}: {
  sources: Sources;
  providers: { google: Mode; microsoft: Mode };
  preferred: "google" | "microsoft" | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  // The phone's contact list is reachable from the web only in some mobile browsers (Chrome on Android).
  const hasPicker = useSyncExternalStore(noop, () => "contacts" in navigator && "ContactsManager" in window, () => false);

  const sync = (entries: string[], source: "phone" | "typed", label: string) =>
    start(async () => {
      if (!entries.length) {
        setStatus({ ok: false, text: "No email addresses or phone numbers found." });
        return;
      }
      const result = await syncContactsAction(entries, detectCountryCode(), source);
      setStatus(result.error ? { ok: false, text: result.error } : { ok: true, text: `✓ Checked ${result.checked} ${label}. Anyone who also has you now appears above.` });
      if (!result.error) {
        setText("");
        setTyping(false);
      }
      router.refresh();
    });

  const emailButtons = (["google", "microsoft"] as const)
    .filter((p) => providers[p] !== "off")
    .sort((a, b) => Number(b === preferred) - Number(a === preferred));
  const anySynced = Object.keys(sources).length > 0;

  return (
    <div>
      <ul className="divide-y divide-border">
        {emailButtons.length > 0 && (
          <Option
            icon="✉️"
            title="Email contacts"
            text="Find friends in your Gmail or Outlook address book. You'll be asked to allow read-only access, once."
            synced={sources.google ?? sources.microsoft}
          >
            {emailButtons.map((p, i) => (
              <a key={p} href={`/api/contacts/${p}`} className={i === 0 ? "btn-primary" : "btn-ghost"}>
                {p === "google" ? "Connect Gmail" : "Connect Outlook"}
              </a>
            ))}
          </Option>
        )}

        <Option
          icon="📱"
          title="Phone contacts"
          text={hasPicker ? "Pick the people in your phone to look for, like WhatsApp does." : "Works in Chrome on Android phones. On iPhone it will come with the AGENTME app."}
          synced={sources.phone}
        >
          {hasPicker && (
            <button
              type="button"
              className="btn-primary"
              disabled={pending}
              onClick={async () => {
                const contacts = (navigator as unknown as { contacts: ContactsManager }).contacts;
                const picked = await contacts.select(["email", "tel"], { multiple: true }).catch(() => []);
                if (picked.length) sync(picked.flatMap((c) => [...(c.email ?? []), ...(c.tel ?? [])]), "phone", "phone contacts");
              }}
            >
              Choose contacts
            </button>
          )}
        </Option>

        <Option icon="✏️" title="Type or paste" text="Add a few emails or phone numbers yourself." synced={sources.typed}>
          {!typing && (
            <button type="button" className="btn-ghost" onClick={() => setTyping(true)}>
              Add
            </button>
          )}
        </Option>
      </ul>

      {typing && (
        <div className="space-y-2 pb-2">
          <textarea
            className="input"
            rows={3}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"marco@gmail.com\n07700 900123"}
            aria-label="Emails and phone numbers"
          />
          <div className="flex gap-2">
            <button type="button" className="btn-primary" disabled={pending || !text.trim()} onClick={() => sync(extractEntries(text), "typed", "contacts")}>
              Find people
            </button>
            <button type="button" className="btn-ghost" onClick={() => setTyping(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {pending && <p className="text-sm text-muted" role="status">Checking…</p>}
      {status && (
        <p className={`text-sm ${status.ok ? "text-accent" : "text-danger"}`} role={status.ok ? "status" : "alert"}>
          {status.text}
        </p>
      )}
      {anySynced && (
        <button
          type="button"
          className="mt-2 text-xs text-muted underline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await clearContactsAction();
              setStatus({ ok: true, text: "Done: everything from your contacts has been forgotten." });
              router.refresh();
            })
          }
        >
          Forget my synced contacts
        </button>
      )}
    </div>
  );
}
