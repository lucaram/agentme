"use client";

import { useState, useTransition } from "react";
import { introduceAction } from "../people-actions";

type Person = { handle: string; display_name: string; avatar: string };

/** Pick two of your contacts who should meet. They connect only if both say yes. */
export function IntroduceForm({ people }: { people: Person[] }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const option = (p: Person) => (
    <option key={p.handle} value={p.handle}>
      {p.avatar} {p.display_name} (@{p.handle})
    </option>
  );
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await introduceAction(a, b, note);
          if (result.error) setMessage({ ok: false, text: result.error });
          else {
            const name = (h: string) => people.find((p) => p.handle === h)?.display_name ?? h;
            setMessage({ ok: true, text: `Sent. ${name(a)} and ${name(b)} will each see it in their Inbox.` });
            setA("");
            setB("");
            setNote("");
          }
        });
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <select className="input" value={a} onChange={(e) => setA(e.target.value)} aria-label="First person" required>
          <option value="">Choose someone…</option>
          {people.filter((p) => p.handle !== b).map(option)}
        </select>
        <select className="input" value={b} onChange={(e) => setB(e.target.value)} aria-label="Second person" required>
          <option value="">…and someone they should meet</option>
          {people.filter((p) => p.handle !== a).map(option)}
        </select>
      </div>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} placeholder="Why should they meet? (optional)" aria-label="Note" />
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={pending || !a || !b}>{pending ? "Sending…" : "Introduce them"}</button>
        {message && <span className={`text-sm ${message.ok ? "text-muted" : "text-danger"}`} role={message.ok ? "status" : "alert"}>{message.text}</span>}
      </div>
    </form>
  );
}
