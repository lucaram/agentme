import Link from "next/link";
import { getUser } from "@/lib/auth";
import { getAgentForUser } from "@/lib/data/agents";
import { isMember } from "@/lib/data/chat";
import { loadInvite } from "@/lib/plans/invites";
import { GuestForm, JoinButton } from "./JoinForms";

export default async function JoinPage({ params }: PageProps<"/join/[token]">) {
  const { token } = await params;
  const invite = await loadInvite(token);
  const user = await getUser();
  const agent = user ? await getAgentForUser(user.id) : null;
  const here = `/join/${token}`;

  if (!invite) {
    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-6 py-16">
        <h1 className="text-xl font-semibold">This invite link doesn&apos;t work any more</h1>
        <p className="text-sm text-muted">It may have expired, been turned off by the organiser, or the plan is over. Ask them for a new link.</p>
        <Link href="/" className="btn-ghost self-start">About AGENTME</Link>
      </main>
    );
  }
  // "In" means in the PLAN (and its group), not only in the group: someone let into the group another way
  // still gets the Join button, which adds them to the plan.
  const joined = Boolean(
    user && agent && (agent.id === invite.organiser.id || (invite.participants.includes(agent.handle) && (await isMember(invite.conversationId, user.id)))),
  );

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-12">
      <section className="card space-y-2" aria-label="Plan">
        <p className="text-xs uppercase tracking-wide text-muted">{invite.organiser.avatar} {invite.organiser.display_name} invited you</p>
        <h1 className="text-2xl font-semibold">{invite.title}</h1>
        {invite.when && <p>🗓️ {invite.when}</p>}
        <p className="text-sm text-muted">👥 {invite.people} {invite.people === 1 ? "person" : "people"} so far</p>
      </section>

      {joined ? (
        <Link href={`/chats/${invite.conversationId}`} className="btn-primary text-center">You&apos;re in: open the plan</Link>
      ) : agent ? (
        <JoinButton token={token} />
      ) : user && !user.isAnonymous ? (
        <Link href={`/onboarding?next=${encodeURIComponent(here)}`} className="btn-primary text-center">Create your agent to join</Link>
      ) : (
        <>
          <GuestForm token={token} />
          <p className="text-center text-sm text-muted">
            Already on AGENTME? <Link className="text-accent underline" href={`/login?next=${encodeURIComponent(here)}`}>Log in</Link>
            {" · "}
            <Link className="text-accent underline" href={`/signup?next=${encodeURIComponent(here)}`}>Create a full account</Link>
          </p>
        </>
      )}
      <p className="hint text-center">
        Joining adds you to this plan&apos;s group chat and connects you with {invite.organiser.display_name}. Your agent never shares your
        private info.
      </p>
    </main>
  );
}
