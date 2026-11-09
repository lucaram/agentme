"use client";

import { useActionState, useState } from "react";
import { createCommunityAction, updateCommunityAction } from "../social-actions";
import { AvatarPicker } from "@/components/social/Controls";
import { CORE_RULES, HOUSE_RULES, LANGUAGES, MAX_DESCRIPTION, MAX_HOUSE_RULES, MAX_NAME, MIN_DESCRIPTION, houseRuleLabel } from "@/lib/social/rules";

type Values = { name: string; description: string; avatar: string; visibility: "public" | "private"; houseRules: string[]; language: string | null };

/** Members accept these before joining: the three core rules (fixed) and up to five house rules picked from a list. */
function RulesPicker({ initial, language }: { initial: string[]; language: string | null }) {
  const [picked, setPicked] = useState<string[]>(initial);
  const full = picked.length >= MAX_HOUSE_RULES;
  const languageRuleOk = Boolean(language && language !== "mixed");
  return (
    <fieldset className="space-y-3">
      <legend className="label">Rules <span className="font-normal text-muted">· members accept them to join</span></legend>
      <ul className="space-y-1 rounded-xl bg-accent-soft/50 px-3 py-2 text-sm" aria-label="Core rules">
        {CORE_RULES.map((r) => (
          <li key={r.id}>
            {r.icon} {r.label} <span className="text-xs text-muted">🔒 always</span>
          </li>
        ))}
      </ul>
      <div className="space-y-2">
        <p className="text-xs text-muted">
          House rules (optional, up to {MAX_HOUSE_RULES}) · {picked.length} of {MAX_HOUSE_RULES} picked
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {HOUSE_RULES.map((r) => {
            const checked = picked.includes(r.id);
            const disabled = (!checked && full) || (r.id === "language_only" && !languageRuleOk);
            return (
              <label
                key={r.id}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${checked ? "border-accent bg-accent-soft" : "border-border"} ${disabled ? "opacity-50" : "cursor-pointer hover:border-accent/60"}`}
              >
                <input
                  type="checkbox"
                  name="house_rules"
                  value={r.id}
                  checked={checked}
                  disabled={disabled}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.id] : p.filter((x) => x !== r.id)))}
                />
                <span>
                  {r.icon} {houseRuleLabel(r.id, language)}
                  {r.check === "code" && <span className="block text-[11px] text-muted">checked automatically</span>}
                </span>
              </label>
            );
          })}
        </div>
        {!languageRuleOk && <p className="text-[11px] text-muted">Choose a language above to use “… only”.</p>}
      </div>
    </fieldset>
  );
}

function Fields({ values, avatars, isOwner, detectLanguage }: { values: Values; avatars: string[]; isOwner: boolean; detectLanguage?: boolean }) {
  const [name, setName] = useState(values.name);
  const [description, setDescription] = useState(values.description);
  const descriptionOk = description.trim().length >= MIN_DESCRIPTION;
  // New communities: the language starts as the creator's browser language (if it's one we list).
  const [language, setLanguage] = useState<string | null>(() => {
    if (values.language || !detectLanguage || typeof navigator === "undefined") return values.language;
    const code = navigator.language?.slice(0, 2).toLowerCase();
    return LANGUAGES.some((l) => l.code === code) ? code : null;
  });
  return (
    <>
      {isOwner && <AvatarPicker options={avatars} initial={values.avatar} />}
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <label className="label" htmlFor="c-name">Name <span className="font-normal text-muted">· required</span></label>
          <span className={`text-xs tabular-nums ${name.length >= MAX_NAME - 5 ? "text-amber-600 dark:text-amber-400" : "text-muted"}`} data-testid="name-counter" aria-live="polite">
            {name.length} / {MAX_NAME}
          </span>
        </div>
        <input
          className="input"
          id="c-name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, MAX_NAME))}
          minLength={3}
          maxLength={MAX_NAME}
          required
          disabled={!isOwner}
          placeholder="e.g. Manchester United fans"
        />
      </div>
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <label className="label" htmlFor="c-description">What is it about? <span className="font-normal text-muted">· required</span></label>
          <span className={`text-xs tabular-nums ${descriptionOk ? "text-accent" : "text-amber-600 dark:text-amber-400"}`} data-testid="description-counter" aria-live="polite">
            {descriptionOk ? `✓ ${description.trim().length} / ${MAX_DESCRIPTION}` : `${description.trim().length} of ${MIN_DESCRIPTION} minimum`}
          </span>
        </div>
        <textarea
          className="input"
          id="c-description"
          name="description"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            e.currentTarget.setCustomValidity("");
          }}
          // Too short: point to what's missing, not a generic error.
          onInvalid={(e) => {
            const missing = MIN_DESCRIPTION - e.currentTarget.value.trim().length;
            e.currentTarget.setCustomValidity(missing > 0 ? `Add ${missing} more ${missing === 1 ? "character" : "characters"}, so people know what it's about.` : "");
          }}
          rows={2}
          minLength={MIN_DESCRIPTION}
          maxLength={MAX_DESCRIPTION}
          required
          placeholder="e.g. Match days, transfers and banter for fans in London"
        />
        <p className="hint mt-1">Shown before people join, and used to keep chats on topic.</p>
      </div>
      <div>
        <label className="label" htmlFor="c-language">Main language <span className="font-normal text-muted">· optional</span></label>
        <select id="c-language" name="language" className="input w-auto" value={language ?? ""} onChange={(e) => setLanguage(e.target.value || null)}>
          <option value="">Not set</option>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>{l.flag} {l.name}</option>
          ))}
        </select>
        <p className="hint mt-1">A tag so people know before joining. Anyone can still write in any language.</p>
      </div>
      <RulesPicker initial={values.houseRules} language={language} />
      {isOwner && (
        <fieldset className="space-y-1">
          <legend className="label">Who can join</legend>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="visibility" value="public" defaultChecked={values.visibility === "public"} className="mt-1" />
            <span>Public<span className="block text-xs text-muted">Listed in Communities; anyone can join after accepting the rules.</span></span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="visibility" value="private" defaultChecked={values.visibility === "private"} className="mt-1" />
            <span>Private<span className="block text-xs text-muted">Not listed; people join with an invite link or ask and a moderator approves.</span></span>
          </label>
        </fieldset>
      )}
    </>
  );
}

export function CreateCommunityForm({ avatars }: { avatars: string[] }) {
  const [state, action, pending] = useActionState(createCommunityAction, undefined);
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
        ＋ New community
      </button>
    );
  }
  return (
    <form action={action} className="card space-y-4" aria-label="New community">
      <h2 className="font-semibold">New community</h2>
      <Fields values={{ name: "", description: "", avatar: avatars[0], visibility: "public", houseRules: [], language: null }} avatars={avatars} isOwner detectLanguage />
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending}>{pending ? "Creating…" : "Create community"}</button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <p className="hint">It comes with two chats: Announcements (only you and moderators post) and General (everyone).</p>
    </form>
  );
}

export function EditCommunityForm({ id, values, avatars, isOwner }: { id: string; values: Values; avatars: string[]; isOwner: boolean }) {
  const [state, action, pending] = useActionState(updateCommunityAction.bind(null, id), undefined);
  return (
    <form action={action} className="space-y-4">
      {/* Disabled inputs aren't submitted: moderators keep the owner's name/visibility. */}
      {!isOwner && (
        <>
          <input type="hidden" name="name" value={values.name} />
          <input type="hidden" name="visibility" value={values.visibility} />
          <input type="hidden" name="avatar" value={values.avatar} />
        </>
      )}
      <Fields values={values} avatars={avatars} isOwner={isOwner} />
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
    </form>
  );
}
