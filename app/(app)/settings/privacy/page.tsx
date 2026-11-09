import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { saveSettings } from "../../actions";
import { PhoneVerify } from "../PhoneVerify";
import { DiscoverableToggle } from "../DiscoverableToggle";
import { SavedNote, SettingsHeader } from "../SettingsHeader";
import { maskEmail } from "@/lib/people/normalise";
import { isManagedLogin } from "@/lib/identities";

function Choice({ name, value, checked, title, hint, type = "radio" }: { name: string; value: string; checked: boolean; title: string; hint: string; type?: "radio" | "checkbox" }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type={type} name={name} value={value} defaultChecked={checked} className="mt-1" />
      <span>
        {title}
        <span className="block hint">{hint}</span>
      </span>
    </label>
  );
}

/** Settings → Privacy: who can reach your agent, add you to groups, find you, and ask you for tips. */
export default async function PrivacySettingsPage({ searchParams }: PageProps<"/settings/privacy">) {
  const { user, agent } = await requireAgent();
  const { saved } = await searchParams;
  const supabase = await createClient();
  const { data: identifiers } = await supabase.from("agent_identifiers").select("kind, hint");
  const phone = identifiers?.find((i) => i.kind === "phone")?.hint ?? null;
  const managedBusiness = isManagedLogin(user.email);

  return (
    <div className="space-y-6">
      <SettingsHeader title="Privacy" hint="Who can reach your agent, add you to groups, find you, and ask you for tips." />
      <SavedNote show={saved === "1"} />

      <form action={saveSettings} className="space-y-6">
        <input type="hidden" name="return_to" value="/settings/privacy" />
        <section className="card space-y-3">
          <h2 className="font-semibold">Who can contact your agent</h2>
          <Choice name="contact_policy" value="contacts_only" checked={agent.contact_policy === "contacts_only"} title="Only my contacts" hint="Recommended for personal agents." />
          <Choice name="contact_policy" value="anyone" checked={agent.contact_policy === "anyone"} title="Anyone" hint="Strangers' agents can ask questions. Private data is still never shared with non-contacts." />
          <Choice name="contact_policy" value="nobody" checked={agent.contact_policy === "nobody"} title="Nobody" hint="Your agent ignores all incoming requests." />
        </section>

        <section className="card space-y-3">
          <h2 className="font-semibold">Who can add you to groups</h2>
          <Choice name="group_add_policy" value="contacts" checked={agent.group_add_policy === "contacts"} title="My contacts" hint="Contacts can add you to a group directly." />
          <Choice name="group_add_policy" value="nobody" checked={agent.group_add_policy === "nobody"} title="Nobody: send me an invite" hint="Your agent asks you in My Agent and you decide whether to join." />
        </section>

        {agent.type === "personal" && (
          <section className="card space-y-3">
            <h2 className="font-semibold">Recommendations</h2>
            <Choice
              type="checkbox"
              name="recommendations_ok"
              value="on"
              checked={agent.recommendations_ok}
              title="Friends can ask me for recommendations"
              hint="When a contact asks around (“does anyone know a good plumber?”), you're asked too. You can always say “I don't know”; they're never told."
            />
            <input type="hidden" name="recommendations_form" value="1" />
          </section>
        )}

        <div className="flex justify-end">
          <button className="btn-primary px-6">Save</button>
        </div>
      </form>

      {!agent.guest && !managedBusiness && (
        <section id="find-me" className="card space-y-3">
          <div>
            <h2 className="font-semibold">How friends can find you</h2>
            <p className="hint">People who have your email or number in their contacts can find you on AGENTME. Your details are never shown to them.</p>
          </div>
          <DiscoverableToggle initial={agent.discoverable} />
          <p className="text-sm">✉️ {user.email && user.emailConfirmed ? `${maskEmail(user.email)} ✓` : "Your email isn't verified yet."}</p>
          <PhoneVerify current={phone} />
        </section>
      )}
    </div>
  );
}
