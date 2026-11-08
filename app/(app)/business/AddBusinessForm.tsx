"use client";

import { useActionState, useEffect, useState } from "react";
import { checkHandle } from "@/app/onboarding/actions";
import { addBusinessAction } from "../identity-actions";

const AVATARS = ["🏪", "🍝", "☕", "🍕", "💇", "🛠️", "🏋️", "🛍️", "🎨", "🩺"];
const suggest = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20);

/** Name, @address, picture and a few words: the business agent is live straight away. */
export function AddBusinessForm() {
  const [state, action, pending] = useActionState(addBusinessAction, undefined);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [edited, setEdited] = useState(false);
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const shown = edited ? handle : suggest(name);

  useEffect(() => {
    if (shown.length < 3) return;
    let live = true;
    const timer = setTimeout(async () => {
      const result = await checkHandle(shown);
      if (live) setStatus(result);
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [shown]);

  return (
    <form action={action} className="space-y-5" aria-label="Add a business">
      <input type="hidden" name="avatar" value={avatar} />
      <div>
        <label className="label" htmlFor="biz-name">Business name</label>
        <input className="input" id="biz-name" name="name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Trattoria da Luca" />
      </div>
      <div>
        <label className="label" htmlFor="biz-handle">Agent address</label>
        <div className="flex items-center gap-1">
          <span className="text-muted">@</span>
          <input
            className="input"
            id="biz-handle"
            name="handle"
            required
            value={shown}
            onChange={(e) => {
              setEdited(true);
              setHandle(e.target.value.toLowerCase());
            }}
            autoCapitalize="none"
            autoComplete="off"
          />
        </div>
        {status && shown.length >= 3 && (
          <p className={`mt-1 text-xs ${status.ok ? "text-accent" : "text-danger"}`} aria-live="polite">{status.message}</p>
        )}
        <p className="hint mt-1">What customers type or scan to reach your business. It can&apos;t be changed later.</p>
      </div>
      <div>
        <span className="label">Picture</span>
        <div className="flex flex-wrap gap-2">
          {AVATARS.map((a) => (
            <button
              key={a}
              type="button"
              aria-label={`Picture ${a}`}
              aria-pressed={avatar === a}
              onClick={() => setAvatar(a)}
              className={`h-10 w-10 rounded-full border text-xl ${avatar === a ? "border-accent bg-accent-soft" : "border-border bg-surface"}`}
            >
              {a}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="label" htmlFor="biz-about">In a few words <span className="font-normal text-muted">· optional, public</span></label>
        <textarea
          id="biz-about"
          name="about"
          className="input"
          rows={4}
          maxLength={8000}
          placeholder={"Family-run Italian restaurant in Camden.\nOpen Tue–Sun 12–15 and 18–23."}
        />
        <p className="hint mt-1">You can add your website, menu and more in My Business afterwards.</p>
      </div>
      {state?.error && <p className="text-sm text-danger" role="alert">{state.error}</p>}
      <button className="btn-primary w-full" disabled={pending}>{pending ? "Creating…" : "Create business"}</button>
    </form>
  );
}
