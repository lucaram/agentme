"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addFromListAction, discardListAction } from "../people-actions";
import type { ContactListView } from "@/lib/people/imports";

const SOURCE_LABEL: Record<ContactListView["source"], string> = {
  google: "Gmail contacts",
  microsoft: "Outlook contacts",
  phone: "phone contacts",
  typed: "contacts",
};

const label = (p: { name: string | null; address: string }) => (p.name ? `${p.name} (${p.address})` : p.address);

function inviteHref(address: string, name: string | null, myLink: string, myName: string) {
  const first = name?.split(" ")[0];
  const body = `Hi${first ? ` ${first}` : ""}! I'm on AGENTME, where our agents can organise plans for us. Add me: ${myLink}\n\n${myName}`;
  if (address.includes("@")) {
    return `mailto:${encodeURIComponent(address)}?subject=${encodeURIComponent("Join me on AGENTME")}&body=${encodeURIComponent(body)}`;
  }
  return `sms:${address.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(body)}`;
}

/**
 * After connecting contacts: tick the people on AGENTME you want to add, or
 * invite the ones who aren't on it yet (from your own email/SMS app).
 */
export function ContactList({ list, myLink, myName }: { list: ContactListView; myLink: string; myName: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const q = query.trim().toLowerCase();
  const matches = (p: { name: string | null; address: string }) => !q || label(p).toLowerCase().includes(q);
  const onAgentme = list.onAgentme.filter(matches);
  const others = list.others.filter(matches);
  const addable = onAgentme.filter((p) => p.status === "none");
  const visibleOthers = showAll || q ? others : others.slice(0, 20);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-5" data-testid="contact-list">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">
          Your {SOURCE_LABEL[list.source]}: {list.onAgentme.length} on AGENTME · {list.others.length} not yet
        </p>
        <button
          type="button"
          className="btn-ghost"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await discardListAction();
              router.refresh();
            })
          }
        >
          Done
        </button>
      </div>

      {list.onAgentme.length + list.others.length > 12 && (
        <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your contacts" aria-label="Search your contacts" />
      )}

      <section aria-label="On AGENTME">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">On AGENTME</h3>
        {onAgentme.length === 0 ? (
          <p className="text-sm text-muted">None of {q ? "these" : "your contacts"} are on AGENTME yet. Invite them below!</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {onAgentme.map((p) => (
              <li key={p.agentId}>
                <label className={`flex items-center gap-3 px-3 py-2.5 ${p.status === "none" ? "cursor-pointer hover:bg-accent-soft" : ""}`}>
                  {p.status === "none" ? (
                    <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={picked.has(p.agentId)} onChange={() => toggle(p.agentId)} aria-label={label(p)} />
                  ) : (
                    <span className="w-4" />
                  )}
                  <span className="text-xl">{p.avatar}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{label(p)}</span>
                    <span className="block text-xs text-muted">@{p.handle} on AGENTME</span>
                  </span>
                  {p.status === "accepted" && <span className="text-xs text-accent">✓ Contact</span>}
                  {p.status === "pending" && <span className="text-xs text-muted">Requested</span>}
                </label>
              </li>
            ))}
          </ul>
        )}
        {addable.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={pending || picked.size === 0}
              onClick={() =>
                start(async () => {
                  const result = await addFromListAction([...picked]);
                  setPicked(new Set());
                  setMessage(
                    result.error
                      ? { ok: false, text: result.error }
                      : { ok: true, text: `Sent ${result.added} contact request${result.added === 1 ? "" : "s"}. They'll appear in Contacts when accepted.` },
                  );
                  router.refresh();
                })
              }
            >
              {picked.size ? `Add ${picked.size} selected` : "Add selected"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setPicked(new Set(addable.map((p) => p.agentId)))}>
              Select all
            </button>
          </div>
        )}
        {message && (
          <p className={`mt-2 text-sm ${message.ok ? "text-accent" : "text-danger"}`} role={message.ok ? "status" : "alert"}>
            {message.text}
          </p>
        )}
      </section>

      {list.others.length > 0 && (
        <section aria-label="Invite to AGENTME">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Invite to AGENTME</h3>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {visibleOthers.map((p) => (
              <li key={p.address} className="flex items-center gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm">{label(p)}</span>
                <a className="btn-ghost text-xs" href={inviteHref(p.address, p.name, myLink, myName)}>
                  Invite
                </a>
              </li>
            ))}
          </ul>
          {!showAll && !q && others.length > 20 && (
            <button type="button" className="mt-2 text-sm text-accent underline" onClick={() => setShowAll(true)}>
              Show all {others.length}
            </button>
          )}
          <p className="hint mt-2">Invite opens your own email or messages app. AGENTME doesn&apos;t send or keep anything.</p>
        </section>
      )}
    </div>
  );
}
