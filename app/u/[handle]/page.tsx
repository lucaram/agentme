import Link from "next/link";
import { notFound } from "next/navigation";
import { getUser } from "@/lib/auth";
import { getAgentByHandle, getAgentForUser, getContactRow } from "@/lib/data/agents";
import { verifyLiveConnectToken } from "@/lib/people/crypto";
import { ActionButton } from "@/components/ActionButton";
import { connectNowAction } from "@/app/(app)/people-actions";
import { openAgentChat, requestContact } from "@/app/(app)/actions";

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

  // A business's page (what its permanent QR code opens): ask its agent first, become a customer second.
  if (other.type === "business") {
    const bio = other.bio ?? (other.business_info as { description?: string } | null)?.description ?? null;
    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-5 px-6 py-16 text-center">
        <div className="text-6xl">{other.avatar}</div>
        <div>
          <h1 className="text-2xl font-semibold">{other.display_name}</h1>
          <p className="text-sm text-muted">@{other.handle} · Business</p>
          {bio && <p className="mt-2 text-sm">{bio}</p>}
        </div>
        {!me ? (
          <div className="flex w-full flex-col gap-2">
            <Link href={`/signup?next=${encodeURIComponent(here)}`} className="btn-primary">💬 Ask us anything</Link>
            <p className="hint">Our AI agent answers straight away. You&apos;ll need a free AGENTME account (it takes a minute).</p>
            <Link href={`/login?next=${encodeURIComponent(here)}`} className="btn-ghost">I already have an account</Link>
          </div>
        ) : me.id === other.id ? (
          <p className="text-sm text-muted">
            This is your business page: it&apos;s what your QR code opens. <Link className="text-accent underline" href="/print/qr">Print your poster</Link>
          </p>
        ) : (
          <div className="w-full space-y-3">
            <ActionButton action={openAgentChat.bind(null, other.id)} label="💬 Ask us anything" variant="btn-primary" block />
            <p className="hint">Opens a chat with {other.display_name}&apos;s AI agent. It answers from what the business shared and never takes payments.</p>
            {relation === "accepted" ? (
              <p className="text-sm text-accent">✓ You&apos;re a customer</p>
            ) : relation === "pending" ? (
              <p className="text-sm text-muted">Request sent: you&apos;ll be a customer once they accept.</p>
            ) : relation === "blocked" ? null : (
              <div className="space-y-1 border-t border-border pt-3">
                <ActionButton action={requestContact.bind(null, other.handle)} label="Become a customer" block />
                <p className="hint">Customers can also get information the business shares only with its customers.</p>
              </div>
            )}
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-5 px-6 py-16 text-center">
      <div className="text-6xl">{other.avatar}</div>
      <div>
        {/* Signed-out visitors only see the address that is already in the link. */}
        {me && <h1 className="text-2xl font-semibold">{other.display_name}</h1>}
        <p className={me ? "text-muted" : "text-2xl font-semibold"}>@{other.handle}</p>
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
          <ActionButton action={connectNowAction.bind(null, other.handle, k as string)} label="Connect now" variant="btn-primary" block />
          <p className="hint">You scanned their code in person, so you&apos;ll be connected straight away.</p>
        </div>
      ) : relation === "pending" ? (
        <p className="text-sm text-muted">Request sent. You&apos;ll be connected when they accept.</p>
      ) : (
        <div className="w-full space-y-2">
          <ActionButton action={requestContact.bind(null, other.handle)} label="Send contact request" variant="btn-primary" block />
          <p className="hint">They&apos;ll be asked to accept.</p>
        </div>
      )}
    </main>
  );
}
