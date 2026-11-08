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
/** What the AGENTME native app (iOS/Android) will expose to this page: the phone's own contacts. */
type NativeBridge = { pickContacts?: () => Promise<{ name: string | null; emails: string[]; phones: string[] }[]> };

const noop = () => () => {};
const nativeBridge = () => (window as unknown as { AgentmeNative?: NativeBridge }).AgentmeNative;

/** Where "Connect" reads contacts from on this device: the native app, the phone's picker, or the account email. */
function deviceSource(): "native" | "picker" | "email" {
  if (nativeBridge()?.pickContacts) return "native";
  if ("contacts" in navigator && "ContactsManager" in window) return "picker";
  return "email";
}

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

const latest = (...dates: (string | undefined)[]) => dates.filter(Boolean).sort().at(-1);

/**
 * Find people you know: "Connect" uses the best source on this device (the
 * phone's contacts in the app or a phone browser that allows it, otherwise the
 * contacts of the email you registered with), or type a few yourself. Either
 * way you get a list to tick from; nobody is added automatically.
 */
export function FindPeople({ sources, unsupported }: { sources: Sources; unsupported: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [typing, setTyping] = useState(Boolean(unsupported));
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const source = useSyncExternalStore(noop, deviceSource, () => "email" as const);

  const check = (contacts: RawContact[], from: "phone" | "typed") =>
    start(async () => {
      setError(null);
      if (!contacts.length) {
        setError("No email addresses or phone numbers found.");
        return;
      }
      const result = await createListAction(contacts, detectCountryCode(), from);
      if (result.error) setError(result.error);
      else {
        setText("");
        setTyping(false);
      }
      router.refresh();
    });

  const connectOnDevice = async () => {
    if (source === "native") {
      const picked = (await nativeBridge()!.pickContacts!().catch(() => [])) ?? [];
      check(picked.map((c) => ({ name: c.name, addresses: [...c.emails, ...c.phones] })), "phone");
    } else {
      const contacts = (navigator as unknown as { contacts: ContactsManager }).contacts;
      const picked = await contacts.select(["name", "email", "tel"], { multiple: true }).catch(() => [] as PickerContact[]);
      if (picked.length) check(picked.map((c) => ({ name: c.name?.[0] ?? null, addresses: [...(c.email ?? []), ...(c.tel ?? [])] })), "phone");
    }
  };

  return (
    <div>
      <ul className="divide-y divide-border">
        <Option icon="👥" title="Contacts" text="Find friends from your contacts. You choose who to add." synced={latest(sources.google, sources.microsoft, sources.phone)}>
          <a
            href="/api/contacts/connect"
            className="btn-primary"
            aria-disabled={pending}
            onClick={(e) => {
              if (source === "email") return; // the server reads the contacts of your account email
              e.preventDefault();
              void connectOnDevice();
            }}
          >
            Connect
          </a>
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
          {unsupported && (
            <p className="text-sm text-muted" role="status">
              Contacts from @{unsupported} can&apos;t be read automatically, so type or paste a few instead.
            </p>
          )}
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
