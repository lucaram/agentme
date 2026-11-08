"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clearContactsAction, syncContactsAction } from "../people-actions";
import { extractEntries } from "@/lib/people/normalise";
import { LocalTime } from "@/components/LocalTime";

/** Calling codes for the most common regions, to complete numbers saved without one. */
const CODES: Record<string, string> = {
  GB: "+44", IE: "+353", IT: "+39", US: "+1", CA: "+1", FR: "+33", DE: "+49", ES: "+34", PT: "+351",
  NL: "+31", BE: "+32", CH: "+41", AT: "+43", AU: "+61", NZ: "+64", IN: "+91", BR: "+55", MX: "+52",
};
const guessCode = () => {
  try {
    return CODES[new Intl.Locale(navigator.language).maximize().region ?? ""] ?? "";
  } catch {
    return "";
  }
};

const noop = () => () => {};

type ContactsManager = { select: (props: string[], opts: { multiple: boolean }) => Promise<{ email?: string[]; tel?: string[] }[]> };

/**
 * Find people you know, mutual only. The address book is read on this device;
 * only emails and phone numbers are sent, compared, and then forgotten.
 */
export function FindPeople({ syncedAt }: { syncedAt: string | null }) {
  const [code, setCode] = useState("");
  const [paste, setPaste] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  // The contact picker exists only in some mobile browsers (e.g. Chrome on Android); the server never knows.
  const hasPicker = useSyncExternalStore(noop, () => "contacts" in navigator, () => false);
  const picker = hasPicker ? (navigator as unknown as { contacts: ContactsManager }).contacts : null;

  const sync = (entries: string[]) =>
    start(async () => {
      if (!entries.length) {
        setStatus({ ok: false, text: "No emails or phone numbers found." });
        return;
      }
      const result = await syncContactsAction(entries, code.trim() || guessCode());
      setStatus(
        result.error
          ? { ok: false, text: result.error }
          : { ok: true, text: `Checked ${result.checked} contacts. Anyone who also has you appears above, now or when they sync.` },
      );
      setPaste("");
      router.refresh();
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {picker && (
          <button
            type="button"
            className="btn-primary"
            disabled={pending}
            onClick={async () => {
              const picked = await picker.select(["email", "tel"], { multiple: true }).catch(() => []);
              sync(picked.flatMap((c) => [...(c.email ?? []), ...(c.tel ?? [])]));
            }}
          >
            📱 Choose from my phone
          </button>
        )}
        <label className={`${picker ? "btn-ghost" : "btn-primary"} cursor-pointer`}>
          📇 Upload contacts file
          <input
            type="file"
            accept=".vcf,.csv,.txt,text/vcard,text/csv,text/plain"
            className="sr-only"
            disabled={pending}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) sync(extractEntries(await file.text()));
            }}
          />
        </label>
      </div>
      <details>
        <summary className="cursor-pointer text-sm text-accent">…or paste emails and phone numbers</summary>
        <div className="mt-2 space-y-2">
          <textarea
            className="input"
            rows={3}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder={"marco@example.com\n+44 7700 900123"}
            aria-label="Emails and phone numbers"
          />
          <button type="button" className="btn-primary" disabled={pending || !paste.trim()} onClick={() => sync(extractEntries(paste))}>
            Find people
          </button>
        </div>
      </details>
      <label className="flex flex-wrap items-center gap-2 text-xs text-muted">
        Numbers saved without a country code are from
        <input className="input w-20 py-1 text-xs" value={code} onChange={(e) => setCode(e.target.value)} placeholder="auto" aria-label="Country code" />
      </label>
      {pending && <p className="text-sm text-muted" role="status">Checking…</p>}
      {status && <p className={`text-sm ${status.ok ? "text-muted" : "text-danger"}`} role={status.ok ? "status" : "alert"}>{status.text}</p>}
      {syncedAt && (
        <p className="hint" data-testid="synced-at">
          Last synced <LocalTime iso={syncedAt} />. Sync again from time to time: friends
          who joined since will only show up then.
        </p>
      )}
      {syncedAt && (
        <button type="button" className="text-xs text-muted underline" disabled={pending} onClick={() => start(async () => { await clearContactsAction(); setStatus({ ok: true, text: "Forgotten." }); })}>
          Forget my synced contacts
        </button>
      )}
    </div>
  );
}
