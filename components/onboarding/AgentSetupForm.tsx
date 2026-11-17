"use client";

import { useActionState, useEffect, useState } from "react";
import { checkHandle, suggestAvailableHandle, type OnboardingState } from "@/app/onboarding/actions";
import { AvatarPicker } from "@/components/profile/AvatarPicker";
import { Avatar } from "@/components/Avatar";
import { avatarsFor } from "@/lib/avatars";
import { BUSINESS_LIMITS, maxNameFor, MIN_NAME, SIGNUP_LIMITS } from "@/lib/social/limits";
import { CountedField } from "@/components/CountedField";
import { handleCandidates } from "@/lib/onboarding/details";
import { normalizeHandle } from "@/lib/policy/handles";
import { TOPICS } from "@/lib/profile/topics";
import { NameField } from "@/components/NameField";
import { LimitedField } from "@/components/LimitedField";
import { ShareTiles } from "@/components/profile/ShareTiles";
import { WebsiteField, type WebsiteFill } from "@/components/business/WebsiteField";

/** Shared by signup and “Add a business”: optional details have one destination and validation. */
export function AgentSetupForm({ type, submit, suggestedHandle = "", next = "", managed = false }: {
  type: "personal" | "business"; submit: (state: OnboardingState, form: FormData) => Promise<OnboardingState>;
  suggestedHandle?: string; next?: string; managed?: boolean;
}) {
  const [state, action, pending] = useActionState(submit, undefined);
  const [name, setName] = useState("");
  const [manual, setManual] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<{ source: string; handle: string } | null>(null);
  const source = name.trim() || suggestedHandle;
  const shown = manual ?? (suggestion?.source === source ? suggestion.handle : source ? handleCandidates(source)[0] : "");
  const [status, setStatus] = useState<{ source: string; handle: string; ok: boolean; message: string } | null>(null);
  const [avatar, setAvatar] = useState(avatarsFor(type)[0]);
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!source && manual === null) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const result = manual === null ? await suggestAvailableHandle(source) : await checkHandle(manual);
        if (!live) return;
        if (manual === null) setSuggestion({ source, handle: result.handle });
        setStatus({ ...result, source, handle: result.handle });
      } catch { if (live) setStatus({ source, handle: manual ?? handleCandidates(source)[0], ok: false, message: "Couldn't check this address. Please try again." }); }
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [source, manual]);

  const fillFrom = (fill: WebsiteFill) => {
    if (fill.name) setName(fill.name.slice(0, maxNameFor(type)));
    if (avatarsFor(type).includes(fill.avatar)) setAvatar(fill.avatar);
    if (fill.description) setDescription(fill.description.slice(0, SIGNUP_LIMITS.description));
  };
  const checked = status?.source === source && status.handle === shown;
  return <form action={action} className="space-y-5" aria-label={managed ? "Add a business" : "Create your agent"} onInvalidCapture={(event) => {
    // A partially filled optional Q&A must remain reachable even if its section was closed.
    let parent = (event.target as HTMLElement).parentElement;
    while (parent) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; }
  }}>
    <input type="hidden" name="type" value={type} /><input type="hidden" name="avatar" value={avatar} /><input type="hidden" name="next" value={next} />
    <NameField id="display_name" name={managed ? "name" : "display_name"} label={type === "business" ? "Business name" : "Your name"} max={maxNameFor(type)} min={MIN_NAME} value={name} onValueChange={setName} />
    <div>
      <label className="label" htmlFor="handle">Agent address <span className="font-normal text-muted">· required</span></label>
      <div className="flex items-center gap-1"><span className="text-muted">@</span><input id="handle" name="handle" className="input" required value={shown} onChange={(e) => setManual(normalizeHandle(e.target.value))} autoCapitalize="none" autoComplete="off" maxLength={30} aria-describedby="handle-help" /></div>
      <p id="handle-help" className="hint mt-1">Your unique @address. Check it now; it can&apos;t be changed later.</p>
      <p role="status" className={`mt-1 text-xs ${checked && !status.ok ? "text-danger" : "text-accent"}`}>{shown ? checked ? status.message : "Checking availability…" : "Suggested from your name."}</p>
    </div>
    <details className="rounded-xl border border-border p-3" data-testid="avatar-choice"><summary className="cursor-pointer text-sm"><Avatar value={avatar} className="mr-2 text-xl" />Change avatar</summary>
      <div className="mt-3"><AvatarPicker options={avatarsFor(type)} value={avatar} onChange={setAvatar} business={type === "business"} /></div>
    </details>
    <details className="rounded-2xl border border-border" data-testid="optional-details"><summary className="cursor-pointer p-4 font-medium">Add details now <span className="font-normal text-muted">· Optional</span></summary>
      <div className="space-y-5 border-t border-border p-4">
        <p className="text-sm text-muted">Add a few details to get started, or skip for now.<br />You can add much more later.</p>
        {type === "personal" ? <>
          <PersonalDetail field="availability" />
          <PersonalDetail field="food" />
          <PersonalDetail field="notes" />
        </> : <>
          <WebsiteField onFilled={fillFrom} />
          <div><CountedField id="description" label="About your business" note="· public" max={SIGNUP_LIMITS.description} minRows={2} maxRows={6} value={description} onChange={setDescription} placeholder="A short introduction for your customers" /><p className="hint mt-1">You can write more (up to {BUSINESS_LIMITS.about.toLocaleString("en-GB")} characters) later in My Business.</p></div>
          <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm font-medium">More business details <span className="font-normal text-muted">· Optional</span></summary><div className="mt-4 space-y-5">
            <CountedField id="hours" label="Opening hours" max={SIGNUP_LIMITS.hours} multiline={false} placeholder="e.g. Tue–Sun 12:00–23:00" />
            <SignupQuestions />
          </div></details>
          <p className="hint">Your agent can answer from the details you enter here. Website findings need your review before publishing.</p>
        </>}
      </div>
    </details>
    {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
    <button className="btn-primary w-full" disabled={pending || !shown || !checked || !status.ok}>{pending ? "Creating…" : managed ? "Create business" : "Create my agent"}</button>
  </form>;
}

function PersonalDetail({ field }: { field: "availability" | "food" | "notes" }) {
  const topic = TOPICS.find((t) => t.key === field)!;
  const [share, setShare] = useState(false);
  return <fieldset className="space-y-2"><legend className="mb-1 text-sm font-medium">{topic.icon} {topic.title}</legend>
    <LimitedField name={field} aria-label={topic.title} multiline max={SIGNUP_LIMITS.fact} placeholder={topic.placeholder} />
    {topic.alwaysPrivate ? <p className="hint">Only your agent. Never shared with others.</p> : <><input type="hidden" name={`share_${field}`} value={share ? "on" : ""} /><p className="label mt-3">Who can see this</p><ShareTiles share={share} onChange={setShare} name={`visibility_${field}`} /></>}
  </fieldset>;
}

function SignupQuestions() {
  const [ids, setIds] = useState<number[]>([]);
  return <div className="space-y-3"><p className="text-sm font-medium">Questions &amp; Answers</p><p className="hint">Add up to three now; add more later.</p>
    {ids.map((i) => <SignupQuestion key={i} i={i} remove={() => setIds((old) => old.filter((id) => id !== i))} />)}
    {ids.length < 3 && <button type="button" className="btn-ghost text-sm" onClick={() => setIds((old) => [...old, [1, 2, 3].find((id) => !old.includes(id))!])}>+ Add a question &amp; answer</button>}
  </div>;
}
function SignupQuestion({ i, remove }: { i: number; remove: () => void }) {
  const [q, setQ] = useState(""); const [a, setA] = useState(""); const half = Boolean(q.trim()) !== Boolean(a.trim());
  return <div className="space-y-2 rounded-xl border border-border p-3"><div className="flex items-center justify-between"><span className="text-sm font-medium">Question {i}</span><button type="button" className="text-sm text-muted hover:text-danger" aria-label={`Remove question ${i}`} onClick={remove}>Remove</button></div>
    <LimitedField name={`faq_q_${i}`} aria-label={`FAQ ${i} question`} max={SIGNUP_LIMITS.faqQuestion} value={q} onChange={setQ} required={half && !q.trim()} placeholder="Question" />
    <LimitedField name={`faq_a_${i}`} aria-label={`FAQ ${i} answer`} multiline max={SIGNUP_LIMITS.faqAnswer} value={a} onChange={setA} required={half && !a.trim()} placeholder="Answer" />
    {half && <p className="hint" data-testid="faq-half">Add both a question and answer, or remove this entry.</p>}
  </div>;
}
