"use client";

import { useActionState, useEffect, useState } from "react";
import { AVATARS } from "@/lib/avatars";
import { checkHandle, createAgent } from "./actions";
import { NameField } from "@/components/NameField";
import { MIN_NAME, maxNameFor } from "@/lib/social/limits";

type HandleStatus = { ok: boolean; message: string } | null;

export function OnboardingForm({ suggestedHandle, next }: { suggestedHandle: string; next?: string }) {
  const [state, action, pending] = useActionState(createAgent, undefined);
  const [type, setType] = useState<"personal" | "business">("personal");
  const [handle, setHandle] = useState(suggestedHandle);
  const [status, setStatus] = useState<HandleStatus>(null);
  const [avatar, setAvatar] = useState(AVATARS[0]);

  useEffect(() => {
    if (!handle) return;
    let live = true;
    const timer = setTimeout(async () => {
      const result = await checkHandle(handle);
      if (live) setStatus(result);
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [handle]);

  return (
    <form action={action} className="mt-6 space-y-5">
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="avatar" value={avatar} />
      <input type="hidden" name="next" value={next ?? ""} />

      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Account type">
        {(["personal", "business"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={type === t}
            onClick={() => setType(t)}
            className={`card text-left ${type === t ? "border-accent bg-accent-soft" : ""}`}
          >
            <div className="font-medium">{t === "personal" ? "👤 Personal" : "🏪 Business"}</div>
            <div className="hint">{t === "personal" ? "Coordinate with friends" : "Answer customer questions"}</div>
          </button>
        ))}
      </div>

      <NameField id="display_name" name="display_name" label={type === "business" ? "Business name" : "Your name"} max={maxNameFor(type)} min={MIN_NAME} />

      <div>
        <label className="label" htmlFor="handle">Agent address</label>
        <div className="flex items-center gap-1">
          <span className="text-muted">@</span>
          <input
            className="input"
            id="handle"
            name="handle"
            value={handle}
            onChange={(e) => setHandle(e.target.value.toLowerCase())}
            required
            autoCapitalize="none"
            autoComplete="off"
          />
        </div>
        {status && handle && (
          <p className={`mt-1 text-xs ${status.ok ? "text-accent" : "text-danger"}`} aria-live="polite">{status.message}</p>
        )}
      </div>

      <div>
        <span className="label">Avatar</span>
        <div className="flex flex-wrap gap-2">
          {AVATARS.map((a) => (
            <button
              key={a}
              type="button"
              aria-label={`Avatar ${a}`}
              aria-pressed={avatar === a}
              onClick={() => setAvatar(a)}
              className={`h-10 w-10 rounded-full border text-xl ${avatar === a ? "border-accent bg-accent-soft" : "border-border bg-surface"}`}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      {type === "personal" ? (
        <fieldset className="space-y-3">
          <legend className="label">Preferences (optional)</legend>
          <Fact name="availability" label="Usual availability" placeholder="e.g. Weekday evenings after 6:30 PM; Saturdays after 7 PM" shareDefault />
          <Fact name="food" label="Food preferences" placeholder="e.g. Italian, vegetarian" shareDefault />
          <Fact name="notes" label="Private notes for your agent" placeholder="Never shared with anyone" />
        </fieldset>
      ) : (
        <fieldset className="space-y-3">
          <legend className="label">What should your agent know? (optional)</legend>
          <textarea className="input" name="description" rows={2} placeholder="What your business does" />
          <input className="input" name="hours" placeholder="Opening hours, e.g. Tue–Sun 12:00–23:00" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-2">
              <input className="input" name={`faq_q_${i}`} placeholder={`FAQ ${i}: question`} />
              <input className="input" name={`faq_a_${i}`} placeholder="Answer" />
            </div>
          ))}
          <p className="hint">Your agent answers only from this information. It never takes bookings or payments.</p>
        </fieldset>
      )}

      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <button className="btn-primary w-full" disabled={pending || status?.ok === false}>
        {pending ? "Creating…" : "Create my agent"}
      </button>
    </form>
  );
}

function Fact({ name, label, placeholder, shareDefault }: { name: string; label: string; placeholder: string; shareDefault?: boolean }) {
  return (
    <div>
      <label className="text-sm" htmlFor={name}>{label}</label>
      <input className="input mt-1" id={name} name={name} placeholder={placeholder} maxLength={500} />
      {shareDefault !== undefined && (
        <label className="mt-1 flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" name={`share_${name}`} defaultChecked={shareDefault} />
          Let my agent share this with my contacts&apos; agents when I approve a plan
        </label>
      )}
    </div>
  );
}
