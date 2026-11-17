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
  const { saved, error } = await searchParams;
  if (user.businessRole === "staff") return <div className="space-y-4"><SettingsHeader title="Privacy" /><p className="card">An owner or manager manages business privacy. Your work availability is controlled from the status menu. Switch to your personal account to manage your own privacy.</p></div>;
  const supabase = await createClient();
  const { data: identifiers } = await supabase.from("agent_identifiers").select("kind, hint");
  const phone = identifiers?.find((i) => i.kind === "phone")?.hint ?? null;
  const managedBusiness = Boolean(user.working) || isManagedLogin(user.email);
  const { data: receipts } = await supabase.from("receipt_preferences").select("enabled").eq("user_id", user.id).maybeSingle();
  const { data: mentions } = await supabase.from("mention_preferences").select("enabled").eq("user_id", user.id).maybeSingle();
  const { data: presence } = await supabase.from("presence_preferences").select("visibility").eq("agent_id", agent.id).maybeSingle();

  return (
    <div className="space-y-6">
      <SettingsHeader title="Privacy" hint="Who can reach your agent, add you to groups, find you, and ask you for tips." />
      <SavedNote show={saved === "1"} />
      {error === "mentions" && <p role="alert" className="text-sm text-danger">Couldn&apos;t save your mention preference. Please try again.</p>}
      <section className="card space-y-2"><h2 className="font-semibold">Reporting privacy</h2><p className="text-sm text-muted">Members can report shared messages to local moderators or directly to AGENTME. Reports may include selected surrounding messages, authors and timestamps. The reporter previews what is shared. Private agent exchanges, attachments and shared location data are excluded. AGENTME reviewers cannot browse the rest of your chat, and platform reports are private from local admins.</p></section>
      {error === "receipts" && <p role="alert" className="text-sm text-danger">Couldn&apos;t save your read-receipt preference. Please try again.</p>}

      <form action={saveSettings} className="space-y-6">
        <input type="hidden" name="return_to" value="/settings/privacy" />
        <section className="card space-y-3">
          <h2 className="font-semibold">Online status</h2>
          {agent.type === "business" ? <Choice type="checkbox" name="team_presence" value="on" checked={presence?.visibility === "customers"} title="Show team availability to customers" hint="Shows whether your team is online, busy, away or offline. Your agent can still answer while the team is offline." /> : <>
            <Choice name="presence_visibility" value="contacts" checked={(presence?.visibility ?? "contacts") === "contacts"} title="My contacts" hint="Only accepted contacts can see your online status." />
            <Choice name="presence_visibility" value="nobody" checked={presence?.visibility === "nobody"} title="Nobody" hint="Your status is hidden, including in search and chats." />
          </>}
          <input type="hidden" name="presence_form" value="1" />
          {error === "presence" && <p role="alert" className="text-sm text-danger">Couldn&apos;t save your online-status preference. Please try again.</p>}
        </section>
        <section className="card space-y-3"><h2 className="font-semibold">Mentions</h2><Choice type="checkbox" name="mention_notifications" value="on" checked={mentions?.enabled ?? true} title="Notify me when someone mentions me" hint="Show a small banner while you're using the app. Muted chats stay quiet; unread @ badges remain available." /><input type="hidden" name="mentions_form" value="1" /></section>
        <section className="card space-y-3">
          <h2 className="font-semibold">Read receipts</h2>
          <Choice type="checkbox" name="read_receipts" value="on" checked={receipts?.enabled ?? true} title="Share when I've seen messages" hint="Others can see when their messages appear in your active chat. Delivery receipts still appear when this is off; your unread badges continue to work." />
          <input type="hidden" name="receipts_form" value="1" />
        </section>
        <section className="card space-y-3">
          <h2 className="font-semibold">Who can contact your agent</h2>
          <Choice name="contact_policy" value="contacts_only" checked={agent.contact_policy === "contacts_only"} title="Only my contacts" hint="Recommended for personal agents." />
          <Choice name="contact_policy" value="anyone" checked={agent.contact_policy === "anyone"} title="Anyone" hint="Strangers' agents can ask questions. Private data is still never shared with non-contacts." />
          <Choice name="contact_policy" value="nobody" checked={agent.contact_policy === "nobody"} title="Nobody" hint="Your agent ignores all incoming requests." />
        </section>

        <section className="card space-y-3">
          <h2 className="font-semibold">Group invitations</h2>
          <Choice name="group_add_policy" value="nobody" checked={agent.group_add_policy === "nobody"} title="Ask me first" hint="Recommended. Join or decline invitations in My Agent." />
          <Choice name="group_add_policy" value="contacts" checked={agent.group_add_policy === "contacts"} title="Allow my contacts to add me directly" hint="Applies to new groups, including groups created by agents." />
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

        {agent.type === "personal" && (
          <section className="card space-y-3">
            <h2 className="font-semibold">Look-ups</h2>
            <Choice
              type="checkbox"
              name="lookup_place"
              value="on"
              checked={agent.lookup_place}
              title="Use my town for look-ups"
              hint="When you ask about the weather or something “near me” without naming a place, your agent uses the town from “Where you usually are”. Only the town goes out with the search, never your street or anything else about you."
            />
            <input type="hidden" name="lookup_form" value="1" />
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
