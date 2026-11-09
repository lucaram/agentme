"use client";

import { useActionState, useEffect, useState } from "react";
import { avatarsFor } from "@/lib/avatars";
import { WebsiteField, type WebsiteFill } from "@/components/business/WebsiteField";
import { checkHandle, createAgent } from "./actions";
import { NameField } from "@/components/NameField";
import { LimitedField } from "@/components/LimitedField";
import { MIN_NAME, SIGNUP_LIMITS, maxNameFor } from "@/lib/social/limits";

type HandleStatus = { ok: boolean; message: string } | null;

export function OnboardingForm({ suggestedHandle, next }: { suggestedHandle: string; next?: string }) {
  const [state, action, pending] = useActionState(createAgent, undefined);
  const [type, setType] = useState<"personal" | "business">("personal");
  const [handle, setHandle] = useState(suggestedHandle);
  const [status, setStatus] = useState<HandleStatus>(null);
  const [picked, setAvatar] = useState("");
  // Businesses choose from the business pictures; the first one until you pick.
  const avatars = avatarsFor(type);
  const avatar = avatars.includes(picked) ? picked : avatars[0];
  // Filled in from the website: the name field restarts with it (key), the rest is state.
  const [filled, setFilled] = useState<{ key: number; name: string }>({ key: 0, name: "" });
  const [description, setDescription] = useState("");
  const fillFrom = (fill: WebsiteFill) => {
    if (fill.name) setFilled((f) => ({ key: f.key + 1, name: fill.name }));
    if (fill.handle) setHandle(fill.handle);
    setAvatar(fill.avatar);
    if (fill.description) setDescription(fill.description.slice(0, SIGNUP_LIMITS.description));
  };

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

      {type === "business" && <WebsiteField onFilled={fillFrom} />}

      <NameField
        key={filled.key}
        id="display_name"
        name="display_name"
        label={type === "business" ? "Business name" : "Your name"}
        max={maxNameFor(type)}
        min={MIN_NAME}
        defaultValue={filled.name}
      />

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
          {avatars.map((a) => (
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
          <div>
            <LimitedField name="description" multiline rows={2} maxRows={6} max={SIGNUP_LIMITS.description} value={description} onChange={setDescription} aria-label="What your business does" placeholder="What your business does" />
            <p className="hint mt-1">A short start. You can add much more later in Business → About your business.</p>
          </div>
          <LimitedField name="hours" max={SIGNUP_LIMITS.hours} aria-label="Opening hours" placeholder="Opening hours, e.g. Tue–Sun 12:00–23:00" />
          {[1, 2, 3].map((i) => (
            <FaqPair key={i} i={i} />
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
      <LimitedField id={name} name={name} multiline max={SIGNUP_LIMITS.fact} placeholder={placeholder} className="mt-1" />
      {shareDefault !== undefined && (
        <label className="mt-1 flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" name={`share_${name}`} defaultChecked={shareDefault} />
          Let my agent share this with my contacts&apos; agents when I approve a plan
        </label>
      )}
    </div>
  );
}

/** One FAQ: a question needs its answer (and the other way round), or the pair would be dropped. */
function FaqPair({ i }: { i: number }) {
  const [q, setQ] = useState("");
  const [a, setA] = useState("");
  const half = Boolean(q.trim()) !== Boolean(a.trim());
  const hintId = `faq-hint-${i}`;
  return (
    <div>
      <div className="grid gap-2 sm:grid-cols-2">
        <LimitedField name={`faq_q_${i}`} max={SIGNUP_LIMITS.faqQuestion} value={q} onChange={setQ} required={half && !q.trim()} aria-label={`FAQ ${i} question`} aria-describedby={half ? hintId : undefined} placeholder={`FAQ ${i}: question`} />
        <LimitedField name={`faq_a_${i}`} multiline max={SIGNUP_LIMITS.faqAnswer} value={a} onChange={setA} required={half && !a.trim()} aria-label={`FAQ ${i} answer`} aria-describedby={half ? hintId : undefined} placeholder="Answer" />
      </div>
      {half && (
        <p id={hintId} className="mt-1 text-xs text-amber-600 dark:text-amber-400" data-testid="faq-half">
          {q.trim() ? "Add an answer, or clear the question." : "Add the question, or clear the answer."}
        </p>
      )}
    </div>
  );
}
