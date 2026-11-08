import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CATEGORY_LABELS, FACT_CATEGORIES } from "@/lib/policy/disclosure";
import { deleteAccount, saveSettings } from "../actions";
import { PhoneVerify } from "./PhoneVerify";
import { SaveAccount } from "./SaveAccount";
import { DiscoverableToggle } from "./DiscoverableToggle";
import { maskEmail } from "@/lib/people/normalise";

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const { user, agent } = await requireAgent();
  const { saved, error } = await searchParams;
  const supabase = await createClient();
  const [{ data: facts }, { data: identifiers }] = await Promise.all([
    supabase.from("agent_facts").select("category, value, disclosure"),
    supabase.from("agent_identifiers").select("kind, hint"),
  ]);
  const hint = (kind: string) => identifiers?.find((i) => i.kind === kind)?.hint ?? null;
  const fact = (c: string) => facts?.find((f) => f.category === c);
  const info = agent.business_info as { description?: string; hours?: string; faqs?: { q: string; a: string }[] };

  return (
    <div className="space-y-8">
      {saved === "account" && <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm" role="status">Your account is saved. You can now log in with your email anywhere.</p>}
      {agent.guest && (
        <section id="account" className="card space-y-3 border-accent">
          <h2 className="font-semibold">Save your account</h2>
          <p className="hint">You joined as a guest, so this account only lives in this browser. Add an email and password to keep your plans, chats and contacts.</p>
          <SaveAccount />
        </section>
      )}
      {!agent.guest && (
        <section id="find-me" className="card space-y-3">
          <div>
            <h2 className="font-semibold">How friends can find you</h2>
            <p className="hint">People who have your email or number in their contacts can find you on AGENTME. Your details are never shown to them.</p>
          </div>
          <DiscoverableToggle initial={agent.discoverable} />
          <p className="text-sm">✉️ {user.email && user.emailConfirmed ? `${maskEmail(user.email)} ✓` : "Your email isn't verified yet."}</p>
          <PhoneVerify current={hint("phone")} />
        </section>
      )}
      <form action={saveSettings} className="space-y-6">
        {saved && saved !== "account" && <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm" role="status">Saved.</p>}
        <section className="card space-y-3">
          <h2 className="font-semibold">Profile</h2>
          <div>
            <label className="label" htmlFor="display_name">Name</label>
            <input className="input" id="display_name" name="display_name" defaultValue={agent.display_name} maxLength={60} />
          </div>
          <p className="hint">Your address @{agent.handle} is permanent.</p>
        </section>

        <section className="card space-y-3">
          <h2 className="font-semibold">Who can contact your agent</h2>
          {(
            [
              ["contacts_only", "Only my contacts", "Recommended for personal agents."],
              ["anyone", "Anyone", "Strangers' agents can ask questions. Private data is still never shared with non-contacts."],
              ["nobody", "Nobody", "Your agent ignores all incoming requests."],
            ] as const
          ).map(([value, title, hint]) => (
            <label key={value} className="flex items-start gap-2 text-sm">
              <input type="radio" name="contact_policy" value={value} defaultChecked={agent.contact_policy === value} className="mt-1" />
              <span>
                {title}
                <span className="block hint">{hint}</span>
              </span>
            </label>
          ))}
        </section>

        {agent.type === "personal" ? (
          <section className="card space-y-4">
            <div>
              <h2 className="font-semibold">What your agent knows and may share</h2>
              <p className="hint">
                Shared items are only given to your contacts&apos; agents, only when they ask for that specific kind of information as part of a
                plan. Private items are never given to any other agent.
              </p>
            </div>
            {FACT_CATEGORIES.map((c) => (
              <div key={c}>
                <label className="label" htmlFor={c}>{CATEGORY_LABELS[c]}</label>
                <input className="input" id={c} name={c} defaultValue={fact(c)?.value ?? ""} maxLength={500} />
                {c === "notes" ? (
                  <p className="mt-1 hint">🔒 Always private.</p>
                ) : (
                  <label className="mt-1 flex items-center gap-2 text-xs">
                    <input type="checkbox" name={`share_${c}`} defaultChecked={fact(c)?.disclosure === "contacts"} />
                    Share with contacts&apos; agents
                  </label>
                )}
              </div>
            ))}
          </section>
        ) : (
          <section className="card space-y-3">
            <h2 className="font-semibold">Business information (public)</h2>
            <p className="hint">Your agent answers only from this. It never takes bookings, orders or payments.</p>
            <textarea className="input" name="description" rows={2} defaultValue={info.description ?? ""} placeholder="Description" />
            <input className="input" name="hours" defaultValue={info.hours ?? ""} placeholder="Opening hours" />
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-2">
                <input className="input" name={`faq_q_${i}`} defaultValue={info.faqs?.[i - 1]?.q ?? ""} placeholder={`FAQ ${i}: question`} />
                <input className="input" name={`faq_a_${i}`} defaultValue={info.faqs?.[i - 1]?.a ?? ""} placeholder="Answer" />
              </div>
            ))}
          </section>
        )}
        <button className="btn-primary">Save</button>
      </form>

      <section className="card space-y-3 border-danger">
        <h2 className="font-semibold text-danger">Delete account</h2>
        <p className="text-sm text-muted">
          Permanently deletes your agent, preferences, contacts, private chats, tasks and audit history. Messages you sent in shared
          chats stay for other members, without your name.
        </p>
        <form action={deleteAccount} className="flex flex-wrap gap-2">
          <input className="input max-w-xs" name="confirm" placeholder={`Type ${agent.handle} to confirm`} aria-label="Confirm handle" />
          <button className="btn-danger">Delete everything</button>
        </form>
        {error === "confirm" && <p className="text-sm text-danger">Type your handle exactly to confirm.</p>}
      </section>
    </div>
  );
}
