"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createListAction } from "../people-actions";
import { extractEntries } from "@/lib/people/normalise";
import { detectCountryCode } from "@/lib/people/country";
import { LocalTime } from "@/components/LocalTime";
import type { RawContact } from "@/lib/people/imports";

type Sources = Partial<Record<"google" | "microsoft" | "phone" | "typed", string>>;
type PickerContact = { name?: string[]; email?: string[]; tel?: string[] };
type ContactsManager = { select: (props: string[], opts: { multiple: boolean }) => Promise<PickerContact[]> };
export type EmailOption = { email: string; href: string | null; simulated: boolean };

const noop = () => () => {};

function Option({ icon, title, text, synced, children }: { icon: string; title: string; text: React.ReactNode; synced?: string; children?: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
      <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xl">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-muted">{text}</span>
        {synced && (
          <span className="mt-0.5 block text-xs text-accent">
            ✓ Last checked <LocalTime iso={synced} />
          </span>
        )}
      </span>
      {children && <span className="flex flex-wrap gap-2">{children}</span>}
    </li>
  );
}

/**
 * Three ways to find people you know. Each one shows a list to tick from;
 * nobody is added automatically.
 */
export function FindPeople({ sources, email }: { sources: Sources; email: EmailOption }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The phone's contact list is reachable from the web only in some mobile browsers (Chrome on Android).
  const hasPicker = useSyncExternalStore(noop, () => "contacts" in navigator && "ContactsManager" in window, () => false);

  const check = (contacts: RawContact[], source: "phone" | "typed") =>
    start(async () => {
      setError(null);
      if (!contacts.length) {
        setError("No email addresses or phone numbers found.");
        return;
      }
      const result = await createListAction(contacts, detectCountryCode(), source);
      if (result.error) setError(result.error);
      else {
        setText("");
        setTyping(false);
      }
      router.refresh();
    });

  const domain = email.email.split("@")[1] ?? "";

  return (
    <div>
      <ul className="divide-y divide-border">
        <Option
          icon="✉️"
          title="Email contacts"
          text={
            email.href ? (
              <>
                Everyone in the address book of <b className="text-foreground">{email.email}</b>.{email.simulated && " (Development: simulated contacts.)"}
              </>
            ) : (
              <>Connecting contacts from @{domain} isn&apos;t available yet. Type or paste them instead.</>
            )
          }
          synced={sources.google ?? sources.microsoft}
        >
          {email.href && (
            <a href={email.href} className="btn-primary">
              Connect
            </a>
          )}
        </Option>

        <Option
          icon="📱"
          title="Phone contacts"
          text={hasPicker ? "The people saved in your phone, like WhatsApp." : "Works in Chrome on Android phones. On iPhone it will come with the AGENTME app."}
          synced={sources.phone}
        >
          {hasPicker && (
            <button
              type="button"
              className="btn-primary"
              disabled={pending}
              onClick={async () => {
                const contacts = (navigator as unknown as { contacts: ContactsManager }).contacts;
                const picked = await contacts.select(["name", "email", "tel"], { multiple: true }).catch(() => [] as PickerContact[]);
                if (picked.length) check(picked.map((c) => ({ name: c.name?.[0] ?? null, addresses: [...(c.email ?? []), ...(c.tel ?? [])] })), "phone");
              }}
            >
              Connect
            </button>
          )}
        </Option>

        <Option icon="✏️" title="Type or paste" text="A few email addresses or phone numbers." synced={sources.typed}>
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
            <button
              type="button"
              className="btn-primary"
              disabled={pending || !text.trim()}
              onClick={() => check(extractEntries(text).map((address) => ({ name: null, addresses: [address] })), "typed")}
            >
              Find people
            </button>
            <button type="button" className="btn-ghost" onClick={() => setTyping(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {pending && <p className="text-sm text-muted" role="status">Checking…</p>}
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
    </div>
  );
}
