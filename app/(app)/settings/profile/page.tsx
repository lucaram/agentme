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
import { adminClient } from "@/lib/supabase/admin";
import { LeaveBusiness } from "./LeaveBusiness";

/** Settings → Profile & account: your name and avatar, your login, and deleting the account. */
export default async function ProfileSettingsPage({ searchParams }: PageProps<"/settings/profile">) {
  const { user, agent } = await requireAgent();
  const { saved, error } = await searchParams;
  const person = await realPerson(user, agent);
  // Working in a business you joined (not its own login): you can leave it yourself.
  const leave = agent.type === "business" && user.working && user.businessRole && person && agent.owner_id !== person
    ? { role: user.businessRole, soleOwner: user.businessRole === "owner" && (await otherOwners(agent.id, person)) === 0 }
    : null;
  const leaveCard = leave && <LeaveBusiness business={agent.display_name} role={leave.role} soleOwner={leave.soleOwner} />;
  if (user.businessRole === "staff") return <div className="space-y-4"><SettingsHeader title="Profile & account" /><p className="card">An owner or manager manages this business profile. Switch to your personal account to edit your own profile.</p>{leaveCard}</div>;
  const managedBusiness = Boolean(user.working) || isManagedLogin(user.email);
  const ownedBusinesses = agent.type === "personal" && person ? await businessesOnlyOwnedBy(person) : [];

  return (
    <div className="space-y-6">
      <SettingsHeader title="Profile & account" />
      <SavedNote show={saved === "account"} text="Your account is saved. You can now log in with your email anywhere." />
      <SavedNote show={saved === "1"} />
      {error === "avatar" && <p role="alert" className="card text-danger">Your avatar could not be saved. Please try another image; your existing avatar is unchanged.</p>}
      {error === "profile" && <p role="alert" className="card text-danger">Your profile could not be saved. Please try again.</p>}

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
        <AvatarChoice key={agent.avatar} options={avatarsFor(agent.type, agent.avatar)} initial={agent.avatar} business={agent.type === "business"} />
        {!agent.guest && !managedBusiness && (
          <p className="text-sm">✉️ {user.email && user.emailConfirmed ? `${maskEmail(user.email)} ✓` : "Your email isn't verified yet."}</p>
        )}
        <div className="flex justify-end border-t border-border pt-4">
          <button className="btn-primary px-6">Save</button>
        </div>
      </form>

      {leaveCard}

      {user.businessRole !== "manager" && <section className="card space-y-3 border-danger" aria-label="Delete account">
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
      </section>}
    </div>
  );
}

/** How many other Owners this business has (the last Owner can't leave). */
async function otherOwners(businessId: string, person: string) {
  const { count } = await adminClient().from("business_managers").select("user_id", { count: "exact", head: true }).eq("business_agent_id", businessId).eq("role", "owner").neq("user_id", person);
  return count ?? 0;
}
