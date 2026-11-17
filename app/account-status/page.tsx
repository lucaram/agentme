import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getUser } from "@/lib/auth";
import { getAgentForUser } from "@/lib/data/agents";
import { createClient } from "@/lib/supabase/server";
import { sessionRestriction } from "@/lib/moderation/session";
import { OwnSanction } from "@/lib/moderation/types";
import { Avatar } from "@/components/Avatar";
import { LocalTime } from "@/components/LocalTime";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { SectionLink } from "@/components/SectionLink";
import { OpenFromHash } from "@/components/OpenFromHash";
import { AccountDecisionCard } from "@/components/moderation/AccountDecisionCard";
import { RestrictionExpiry } from "@/components/moderation/RestrictionExpiry";
import { SettingsHeader } from "@/app/(app)/settings/SettingsHeader";
import { signOut } from "@/app/(auth)/actions";
import { returnToPersonalAccount } from "./actions";

export default async function AccountStatusPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getUser(); if (!user) redirect("/login");
  const page = z.coerce.number().int().min(0).max(400).catch(0).parse((await searchParams).page ?? 0);
  const client = await createClient();
  const [restriction, history, agent] = await Promise.all([sessionRestriction(user.id), client.rpc("own_account_sanctions", { p_offset: page * 25 }), getAgentForUser(user.id)]);
  const parsed = z.array(OwnSanction).safeParse(history.data);
  const loadError = Boolean(history.error) || !parsed.success;
  const sanctions = parsed.success ? parsed.data : [];
  const personalRestriction = Boolean(restriction && restriction.user_key !== user.id);
  const unavailable = restriction?.action === "owner_restricted";
  const title = !restriction ? "Your account is active" : personalRestriction ? "Business access restricted" : unavailable ? "Business identity unavailable" : restriction.action === "ban" ? "Account permanently banned" : "Account temporarily suspended";
  const currentDecision = restriction?.id ? sanctions.slice(0, 25).find((sanction) => sanction.id === restriction.id) : undefined;

  return <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:py-8">
    <RealtimeRefresh channel={`account-status-${user.id}`} tables={["account_access_versions", "platform_account_sanctions", "platform_account_appeals"]} />
    <OpenFromHash />
    {restriction && <RestrictionExpiry until={restriction.expires_at} />}
    <header className="flex items-start justify-between gap-4">
      {restriction ? <div className="space-y-1"><h1 className="text-lg font-semibold">Account decisions</h1><p className="text-xs text-muted">Review account restrictions, decisions and appeals.</p></div> : <SettingsHeader title="Account decisions" hint="Review account restrictions, decisions and appeals." />}
      <form action={signOut} className="shrink-0"><button className="btn-ghost whitespace-nowrap">Log out</button></form>
    </header>
    <section className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-4 sm:p-5" aria-label="Account being reviewed" data-testid="account-decision-identity">
      <Avatar value={agent?.avatar} className="text-3xl" />
      <div className="min-w-0 flex-1"><p className="break-words font-semibold">{agent?.display_name ?? "Your account"}</p>{agent && <p className="break-all text-sm text-muted">@{agent.handle}</p>}</div>
      <span className="shrink-0 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">{agent?.type === "business" ? "Business" : agent ? "Personal" : "Account"}</span>
    </section>
    <section aria-label={restriction ? "Current account restriction" : "Current account status"} data-testid="account-access-status" className={`space-y-4 rounded-2xl border p-5 sm:p-6 ${!restriction ? "border-accent/40 bg-accent-soft/30" : unavailable ? "border-border bg-surface" : "border-danger/40 bg-danger/5"}`}>
      <div className="flex items-start gap-3"><span aria-hidden className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${!restriction ? "bg-accent-soft text-accent" : unavailable ? "bg-raised text-muted" : "bg-danger/10 text-danger"}`}><svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 4 6v6c0 4.5 8 9 8 9s8-4.5 8-9V6l-8-3Z" />{!restriction ? <path d="m8 12 3 3 5-6" /> : <><path d="M12 8v5" /><path d="M12 16h.01" /></>}</svg></span><div className="min-w-0"><p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Current status</p><h2 className="text-lg font-semibold">{title}</h2>{!restriction && <p className="mt-1 text-sm text-muted">No active restrictions.</p>}</div></div>
      {restriction && <>
        {personalRestriction && <p className="text-sm">Your access to this business is restricted because your personal account has an active restriction.</p>}
        <dl className="space-y-3 rounded-xl border border-border/60 bg-surface/50 p-4 text-sm">
          <div><dt className="text-xs text-muted">{personalRestriction ? "Restriction applies to" : "Account"}</dt><dd className="mt-1 break-words font-medium">{restriction.name}</dd></div>
          <div><dt className="text-xs text-muted">{unavailable ? "Access information" : "Justification"}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{restriction.justification}</dd></div>
          {(restriction.created_at || restriction.expires_at) && <div className="grid gap-3 sm:grid-cols-2">{restriction.created_at && <div><dt className="text-xs text-muted">Decision date</dt><dd className="mt-1"><LocalTime iso={restriction.created_at} full /></dd></div>}{restriction.expires_at && <div><dt className="text-xs text-muted">Restriction ends</dt><dd className="mt-1"><LocalTime iso={restriction.expires_at} full /></dd></div>}</div>}
        </dl>
        <p className="text-sm text-muted">{unavailable ? "Sign in again to restore access to this business." : restriction.expires_at ? "Access resumes automatically when this restriction ends, unless another active restriction applies. You can still review and appeal decisions here." : "Account activity, including agent messaging, is restricted. You can still review and appeal decisions here."}</p>
        {personalRestriction ? <form action={returnToPersonalAccount}><button className="btn-primary">Return to my personal account to appeal</button></form> : currentDecision ? <SectionLink id={`decision-${currentDecision.id}`} className="btn-ghost">{currentDecision.appeal ? "View decision and appeal" : "Review decision & appeal"}</SectionLink> : !unavailable && <SectionLink id="decision-history" className="text-sm font-medium text-accent underline">Review decision history and appeals</SectionLink>}
      </>}
    </section>
    <section id="decision-history" className="scroll-mt-8 space-y-3" aria-labelledby="decision-history-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="decision-history-heading" className="font-semibold">Decision history</h2>{sanctions.length > 0 && <p className="text-xs text-muted">Most recent first</p>}</div>
      {loadError ? <div role="alert" className="rounded-2xl border border-border bg-surface p-5 text-sm"><p>Couldn&apos;t load your decision history.</p><Link href={`/account-status?page=${page}`} className="mt-3 inline-flex font-medium text-accent underline">Try again</Link></div> : sanctions.length === 0 ? <div className="rounded-2xl border border-border bg-surface px-5 py-8 text-center text-sm text-muted">{page === 0 ? "No account decisions to display." : "No more account decisions to display."}</div> : <div className="space-y-3">{sanctions.slice(0, 25).map((sanction) => <AccountDecisionCard key={sanction.id} sanction={sanction} />)}</div>}
      {(page > 0 || sanctions.length > 25) && <nav className="flex flex-wrap justify-between gap-3 pt-2 text-sm" aria-label="Decision history pages">{page > 0 && <Link className="btn-ghost" href={`/account-status?page=${page - 1}#decision-history`}>Newer decisions</Link>}{sanctions.length > 25 && <Link className="btn-ghost" href={`/account-status?page=${page + 1}#decision-history`}>Older decisions</Link>}</nav>}
    </section>
  </main>;
}
