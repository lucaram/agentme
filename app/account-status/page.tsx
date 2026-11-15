import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { sessionRestriction } from "@/lib/moderation/session";
import { OwnSanction, actionLabel } from "@/lib/moderation/types";
import { LocalTime } from "@/components/LocalTime";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { AccountAppealForm } from "@/components/moderation/AccountAppealForms";
import { RestrictionExpiry } from "@/components/moderation/RestrictionExpiry";
import { signOut } from "@/app/(auth)/actions";
import { returnToPersonalAccount } from "./actions";

export default async function AccountStatusPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getUser(); if (!user) redirect("/login");
  const page = z.coerce.number().int().min(0).max(400).catch(0).parse((await searchParams).page ?? 0);
  const [restriction, history] = await Promise.all([sessionRestriction(user.id), (await createClient()).rpc("own_account_sanctions", { p_offset: page * 25 })]);
  const sanctions = z.array(OwnSanction).safeParse(history.data).data ?? [];
  const personalRestriction = restriction && restriction.user_key !== user.id;
  return <main className="mx-auto w-full max-w-3xl space-y-5 px-4 py-8"><RealtimeRefresh channel={`account-status-${user.id}`} tables={["account_access_versions", "platform_account_sanctions", "platform_account_appeals"]} />
    {restriction && <RestrictionExpiry until={restriction.expires_at} />}
    <div className="flex items-center justify-between gap-3"><h1 className="text-xl font-semibold">{restriction ? restriction.action === "ban" ? "Account permanently banned" : restriction.action === "owner_restricted" ? "Business identity unavailable" : "Account temporarily suspended" : "Account access available"}</h1><form action={signOut}><button className="btn-ghost">Log out</button></form></div>
    {restriction ? <section className="card space-y-3" aria-label="Current account restriction"><p className="font-medium">{restriction.name}</p><p className="whitespace-pre-wrap text-sm">Justification: {restriction.justification}</p>{restriction.created_at && <p className="text-sm">Decision <LocalTime iso={restriction.created_at} full /></p>}{restriction.expires_at && <p className="text-sm">Ends <LocalTime iso={restriction.expires_at} full />. Access resumes automatically when this restriction ends, unless another active restriction applies.</p>}<p className="text-sm text-muted">Account activity, including agent messaging, is restricted. You can still read the decision and appeal.</p>{personalRestriction && <form action={returnToPersonalAccount}><button className="btn-primary">Return to my personal account to appeal</button></form>}</section> : <p className="text-sm"><Link className="btn-primary" href="/chats">Return to AGENTME</Link></p>}
    {history.error && <p role="alert" className="text-sm text-danger">Couldn&apos;t load your decision history. Refresh and try again.</p>}
    {sanctions.slice(0, 25).map((sanction) => <section key={sanction.id} className="card space-y-3" data-testid="own-account-decision"><h2 className="font-semibold">{actionLabel(sanction.action)}</h2><p className="text-xs text-muted">Decision <LocalTime iso={sanction.created_at} full /></p><p className="whitespace-pre-wrap break-words text-sm">Justification: {sanction.justification}</p>{sanction.expires_at && <p className="text-sm">Ends <LocalTime iso={sanction.expires_at} full /></p>}{sanction.revoked_at ? <p className="text-sm">Lifted <LocalTime iso={sanction.revoked_at} full /> · {sanction.revoke_reason}</p> : sanction.restriction_status === "expired" && <p className="text-sm text-muted">This suspension has expired.</p>}
      {sanction.appeal ? <section className="space-y-2 border-t border-border pt-3" aria-label="Your appeal"><p className="text-sm font-medium">{sanction.appeal.status === "open" ? "Appeal submitted — awaiting an independent reviewer" : sanction.appeal.status === "accepted" ? "Appeal accepted" : "Appeal rejected"}</p><p className="whitespace-pre-wrap text-sm">{sanction.appeal.reason}</p><p className="text-xs text-muted">Submitted <LocalTime iso={sanction.appeal.created_at} full /></p>{sanction.appeal.response && <p className="whitespace-pre-wrap text-sm">Decision justification: {sanction.appeal.response}</p>}{sanction.appeal.reviewed_at && <p className="text-xs text-muted">Reviewed <LocalTime iso={sanction.appeal.reviewed_at} full /></p>}</section> : <AccountAppealForm id={sanction.id} />}
    </section>)}
    <div className="flex gap-3 text-sm">{page > 0 && <Link className="text-accent underline" href={`/account-status?page=${page - 1}`}>Previous decisions</Link>}{sanctions.length > 25 && <Link className="text-accent underline" href={`/account-status?page=${page + 1}`}>More decisions</Link>}</div>
  </main>;
}
