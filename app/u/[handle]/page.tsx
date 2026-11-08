import Link from "next/link";
import { notFound } from "next/navigation";
import { getUser } from "@/lib/auth";
import { getAgentByHandle, getAgentForUser, getContactRow } from "@/lib/data/agents";
import { verifyLiveConnectToken } from "@/lib/people/crypto";
import { ActionButton } from "@/components/ActionButton";
import { connectNowAction } from "@/app/(app)/people-actions";
import { requestContact } from "@/app/(app)/actions";

/**
 * Someone's personal AGENTME link (agentme.app/u/luca), also behind their QR
 * code. A live QR code (?k=…, valid 10 minutes) connects instantly; the plain
 * link sends a normal contact request.
 */
export default async function PersonalLinkPage({ params, searchParams }: PageProps<"/u/[handle]">) {
  const { handle } = await params;
  const { k } = await searchParams;
  const other = await getAgentByHandle(handle);
  if (!other || other.guest) notFound();
  const user = await getUser();
  const me = user ? await getAgentForUser(user.id) : null;
  const live = typeof k === "string" && verifyLiveConnectToken(other.id, k);
  const here = `/u/${other.handle}${typeof k === "string" ? `?k=${encodeURIComponent(k)}` : ""}`;
  const relation = me && me.id !== other.id ? (await getContactRow(me.id, other.id))?.status ?? null : null;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-5 px-6 py-16 text-center">
      <div className="text-6xl">{other.avatar}</div>
      <div>
        {/* Signed-out visitors only see the address that is already in the link. */}
        {me && <h1 className="text-2xl font-semibold">{other.display_name}</h1>}
        <p className={me ? "text-muted" : "text-2xl font-semibold"}>@{other.handle}</p>
        {other.type === "business" && <p className="text-sm text-muted">Business</p>}
      </div>

      {!me ? (
        <div className="flex w-full flex-col gap-2">
          <Link href={`/signup?next=${encodeURIComponent(here)}`} className="btn-primary">Create your agent to connect</Link>
          <Link href={`/login?next=${encodeURIComponent(here)}`} className="btn-ghost">I already have an account</Link>
        </div>
      ) : me.id === other.id ? (
        <p className="text-sm text-muted">This is your own link. <Link className="text-accent underline" href="/contacts">Back to contacts</Link></p>
      ) : relation === "accepted" ? (
        <p className="text-sm text-muted">You&apos;re already connected. <Link className="text-accent underline" href="/contacts">Open contacts</Link></p>
      ) : relation === "blocked" ? (
        <p className="text-sm text-muted">You can&apos;t connect with this person.</p>
      ) : live ? (
        <div className="w-full space-y-2">
          <ActionButton action={connectNowAction.bind(null, other.handle, k as string)} label="Connect now" variant="btn-primary" />
          <p className="hint">You scanned their code in person, so you&apos;ll be connected straight away.</p>
        </div>
      ) : relation === "pending" ? (
        <p className="text-sm text-muted">Request sent. You&apos;ll be connected when they accept.</p>
      ) : (
        <div className="w-full space-y-2">
          <ActionButton action={requestContact.bind(null, other.handle)} label="Send contact request" variant="btn-primary" />
          <p className="hint">They&apos;ll be asked to accept.</p>
        </div>
      )}
    </main>
  );
}
