import { requireAgent } from "@/lib/auth";
import { deleteAccount, saveSettings } from "../../actions";
import { SaveAccount } from "../SaveAccount";
import { AvatarChoice } from "./AvatarChoice";
import { avatarsFor } from "@/lib/avatars";
import { NameField } from "@/components/NameField";
import { MIN_NAME, maxNameFor } from "@/lib/social/limits";
import { SavedNote, SettingsHeader } from "../SettingsHeader";
import { maskEmail } from "@/lib/people/normalise";
import { businessesOnlyOwnedBy, isManagedLogin, realPerson } from "@/lib/identities";

/** Settings → Profile & account: your name and avatar, your login, and deleting the account. */
export default async function ProfileSettingsPage({ searchParams }: PageProps<"/settings/profile">) {
  const { user, agent } = await requireAgent();
  const { saved, error } = await searchParams;
  const managedBusiness = isManagedLogin(user.email);
  const person = await realPerson(user, agent);
  const ownedBusinesses = agent.type === "personal" && person ? await businessesOnlyOwnedBy(person) : [];

  return (
    <div className="space-y-6">
      <SettingsHeader title="Profile & account" />
      <SavedNote show={saved === "account"} text="Your account is saved. You can now log in with your email anywhere." />
      <SavedNote show={saved === "1"} />

      {agent.guest && (
        <section id="account" className="card space-y-3 border-accent">
          <h2 className="font-semibold">Save your account</h2>
          <p className="hint">You joined as a guest, so this account only lives in this browser. Add an email and password to keep your plans, chats and contacts.</p>
          <SaveAccount />
        </section>
      )}

      <form action={saveSettings} className="card space-y-4">
        <input type="hidden" name="return_to" value="/settings/profile" />
        <h2 className="font-semibold">Profile</h2>
        <NameField id="display_name" name="display_name" label="Name" max={maxNameFor(agent.type)} min={MIN_NAME} defaultValue={agent.display_name} />
        <p className="hint">Your address @{agent.handle} is permanent.</p>
        <AvatarChoice options={avatarsFor(agent.type, agent.avatar)} initial={agent.avatar} />
        {!agent.guest && !managedBusiness && (
          <p className="text-sm">✉️ {user.email && user.emailConfirmed ? `${maskEmail(user.email)} ✓` : "Your email isn't verified yet."}</p>
        )}
        <div className="flex justify-end border-t border-border pt-4">
          <button className="btn-primary px-6">Save</button>
        </div>
      </form>

      <section className="card space-y-3 border-danger" aria-label="Delete account">
        <h2 className="font-semibold text-danger">Delete account</h2>
        <p className="text-sm text-muted">
          Permanently deletes your agent, preferences, contacts, private chats, tasks and audit history. Messages you sent in shared chats stay for
          other members, without your name.
          {ownedBusinesses.length > 0 &&
            ` The ${ownedBusinesses.length === 1 ? "business" : `${ownedBusinesses.length} businesses`} you added (and only you manage) ${ownedBusinesses.length === 1 ? "is" : "are"} deleted too.`}
          {managedBusiness && " This deletes only the business; your personal account stays and you're switched back to it."}
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
