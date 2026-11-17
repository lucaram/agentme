import { z } from "zod";
import { TeamDashboardData, TeamOptions } from "@/lib/business/team-types";
import { TeamDashboardFilters } from "@/components/business/TeamDashboardFilters";
import { TeamPerformance } from "@/components/business/TeamPerformance";
import { staffControls } from "@/lib/business/staff-controls";
import Link from "next/link";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { Fold } from "@/components/Fold";
import { OpenFromHash } from "@/components/OpenFromHash";
import { BusinessInfoForm, BusinessDetailsForm, SourcesManager } from "./BusinessForms";
import { QuestionsAnswers } from "./QuestionsAnswers";
import { AddBusinessIntro } from "./AddBusinessIntro";
import { WaysEditor } from "./WaysEditor";
import { TestAgent } from "./TestAgent";
import { waysOf } from "@/lib/business/booking";
import { businessDescription, publicBusinessDetails } from "@/lib/business/details";
import { ActionButton } from "@/components/ActionButton";
import { answerPartnerInviteAction, leavePlacementAction } from "../social-actions";
import { linkKey, linksIn } from "@/lib/business/extract";
import { WebsiteCard } from "./WebsiteCard";
import { verifiesByEmail } from "@/lib/business/site";
import { emailProofEnforced } from "@/lib/business/verify";
import { realPerson } from "@/lib/identities";
import { daysAgo } from "@/lib/social/shared";
import { dayBucket } from "@/lib/social/notices";
import { clearSiteChangesAction } from "./website-actions";

import { businessDashboard, dashboardDays } from "@/lib/business/dashboard";
import { CustomerDashboard } from "./CustomerDashboard";
import { StaffSection } from "@/components/business/StaffSection";
import { BusinessAnswerSuggestion } from "@/components/business/StaffForms";
import { openMyAgent } from "../actions";

type Info = { about?: string; customers?: string; description?: string; hours?: string; address?: string; website?: string | null; faqs?: { q: string; a: string }[] };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const SECTIONS = "business-sections";
const BODY = "space-y-4 px-5 py-5 sm:px-6";

export default async function MyBusinessPage({ searchParams }: PageProps<"/business">) {
  const { user, agent } = await requireAgent();
  if (agent.type !== "business") return <AddBusinessIntro guest={agent.guest} />;
  const { welcome, live, website, website_error, days, scope: requestedScope, person: requestedPerson } = await searchParams;
  const period = dashboardDays(days);
  const supabase = await createClient();
  const info = (agent.business_info ?? {}) as Info;
  const about = businessDescription(info);
  const requiresPublicationApproval = user.businessRole === "staff" ? (await staffControls(user, agent)).require_publication_approval : true;
  if (user.businessRole === "staff") return <div className="space-y-5"><RealtimeRefresh channel={`staff-business-${user.id}`} tables={["business_queue_versions", "presence_preferences"]} /><OpenFromHash /><h1 className="text-lg font-semibold">My Business</h1><p className="text-sm text-muted">Handle customer requests in My Agent. {requiresPublicationApproval ? "Suggest reusable answers for an Owner or Manager to approve." : "Add eligible general answers to Questions & Answers after the publication check."}</p><form action={openMyAgent}><button className="btn-primary">Go to My Agent</button></form><Fold name={SECTIONS} id="about-business" icon="✍️" title="About your business" summary={about.slice(0, 120)}><div className={BODY}><p className="whitespace-pre-wrap text-sm">{about}</p>{info.hours && <p className="text-sm">{info.hours}</p>}</div></Fold><Fold name={SECTIONS} id="questions-answers" icon="💬" title="Questions & Answers" summary={`${info.faqs?.length ?? 0} approved answers`} testId="fold-faqs"><div className={`${BODY} space-y-4`}>{info.faqs?.map((faq, index) => <div key={index} className="text-sm"><p className="font-medium">{faq.q}</p><p className="text-muted">{faq.a}</p></div>)}<BusinessAnswerSuggestion approvalRequired={requiresPublicationApproval} /></div></Fold><Fold name={SECTIONS} id="staff-access" icon="👥" title="Staff & access" summary="Your team, work availability and permissions" testId="fold-staff"><div className={BODY}><StaffSection /></div></Fold></div>;
  const ownerView = user.businessRole === "owner";
  const scope = typeof requestedScope === "string" && ["all", "team", "person"].includes(requestedScope) ? requestedScope : ownerView ? "all" : "team";
  const personId = typeof requestedPerson === "string" && z.uuid().safeParse(requestedPerson).success ? requestedPerson : !ownerView && scope === "team" ? user.actorId ?? user.id : null;
  const [teamResult, optionsResult] = await Promise.all([supabase.rpc("business_team_dashboard", { p_days: period, p_scope: scope, p_person: personId }), supabase.rpc("business_team_dashboard_options")]);
  const teamData = TeamDashboardData.safeParse(teamResult.data); const teamOptions = TeamOptions.safeParse(optionsResult.data);
  // Older failed-signup redirects still work; an explicit removal (null) clears their fallback too.
  const savedWebsite = typeof info.website === "string" ? info.website : "";
  const initialWebsite = savedWebsite || (info.website === undefined && typeof website === "string" ? website.slice(0, 300) : "");
  const { data: allRows, error: sourcesError } = await supabase.from("business_sources").select("*").order("created_at");
  const rows = (allRows ?? []).filter((source) => source.origin === "link");
  const [{ data: site, error: siteError }, person, { data: changes }, dashboard] = await Promise.all([
    supabase.from("business_sites").select("*").maybeSingle(),
    realPerson(user, agent),
    supabase.from("notices").select("id, text, created_at").eq("area", "business").eq("kind", "site_change").is("dismissed_at", null).gte("created_at", daysAgo(30)).order("created_at", { ascending: false }).limit(10),
    ownerView && scope === "all" ? businessDashboard(agent.id, period, user) : Promise.resolve(null),
    supabase.rpc("mark_notices_seen", { p_area: "business" }),
  ]);
  const personEmail = person && person !== user.id ? (await adminClient().auth.admin.getUserById(person)).data.user : null;
  const email = person === user.id ? { address: user.email ?? null, confirmed: Boolean(user.emailConfirmed) } : { address: personEmail?.email ?? null, confirmed: Boolean(personEmail?.email_confirmed_at) };
  const details = publicBusinessDetails(info, site);
  const ways = waysOf(agent.business_info);
  const inAbout = new Set(linksIn(about).map(linkKey));
  const inCustomers = new Set(linksIn(info.customers ?? "").map(linkKey));
  const sources = rows.map((source) => ({
    fromText: inAbout.has(linkKey(source.url)) ? "About your business" : inCustomers.has(linkKey(source.url)) ? "For customers only" : null,
    id: source.id, url: source.url, visibility: source.visibility, status: source.status, kind: source.kind, error: source.error, last_read_at: source.last_read_at,
    words: (source.content ?? "").split(/\s+/).filter(Boolean).length, preview: (source.content ?? "").slice(0, 1500),
    buttonLabel: ways.find((way) => linkKey(way.value) === linkKey(source.url) && way.kind === "custom" && way.purpose === "information")?.label,
  }));
  const faqs = info.faqs ?? [];
  const { data: placementRows } = await supabase.from("business_placements").select("id, conversation_id, community_id, status").order("created_at", { ascending: false });
  const groupIds = (placementRows ?? []).flatMap((p) => p.conversation_id ? [p.conversation_id] : []);
  const communityIds = (placementRows ?? []).flatMap((p) => p.community_id ? [p.community_id] : []);
  const [{ data: groupRows }, { data: communityRows }] = await Promise.all([
    groupIds.length ? adminClient().from("conversations").select("id, title").in("id", groupIds) : Promise.resolve({ data: [] as { id: string; title: string | null }[] }),
    communityIds.length ? adminClient().from("communities").select("id, name").in("id", communityIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const places = (placementRows ?? []).map((p) => ({
    ...p, name: p.conversation_id ? (groupRows ?? []).find((g) => g.id === p.conversation_id)?.title ?? "A group" : (communityRows ?? []).find((c) => c.id === p.community_id)?.name ?? "A community",
  }));
  const invites = places.filter((p) => p.status === "invited").length;
  const groupsCount = places.filter((p) => p.conversation_id).length;
  const communitiesCount = places.filter((p) => p.community_id && p.status !== "invited").length;
  const changeList = changes ?? [];
  const siteSummary = siteError ? "Website status unavailable" : site ? `${site.domain} · ${site.live_at ? "Connected" : site.status === "reading" ? "Reading…" : site.status === "error" ? "Needs attention" : "Ready for review"}` : initialWebsite ? "Website saved · connection needed" : "No website connected";
  const documentsSummary = `${siteSummary}${sources.length ? ` · ${plural(sources.length, "additional document")}` : ""}`;

  return (
    <div className="space-y-6">
      <RealtimeRefresh channel={`business-${user.id}`} tables={["business_sources", "business_sites", "business_action_events", "inbox_items", "task_exchanges", "business_queue_versions", "presence_preferences"]} />
      <OpenFromHash />
      {welcome && <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm" role="status" data-testid="business-welcome">🎉 {agent.display_name} is live at @{agent.handle}. You are now acting as your business. Manage its information below, then share its page with customers.</p>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-lg font-semibold">My Business</h1><p className="text-xs text-muted">Manage your public profile, customer actions and the information your agent uses.</p></div>
        <TestAgent />
      </div>
      {live && <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm" role="status" data-testid="site-live">Your website information is published. Automatic checks are available approximately daily, and changes appear in Website &amp; documents.</p>}
      <div className="space-y-3" data-testid="business-sections">
        <Fold name={SECTIONS} id="customer-dashboard" icon="📊" title="Customer dashboard" testId="fold-activity" summary={dashboard ? `${period} days · ${plural(dashboard.totals.received, "recorded question")} · agent answered ${dashboard.totals.automatic}` : "Team performance and activity"}>
          <span id="customer-inbox" /><span id="customer-activity" />
          <div className="space-y-5 p-5 sm:p-6">
            {teamOptions.success && <TeamDashboardFilters key={`${scope}:${personId}:${period}`} owner={ownerView} actorId={user.actorId ?? user.id} scope={scope} person={personId} days={period} teams={teamOptions.data.teams} people={teamOptions.data.people} />}
            {teamData.success ? <TeamPerformance data={teamData.data} /> : <p role="alert" className="text-sm text-danger">This dashboard view is unavailable. Choose a team or Staff member you can access.</p>}
          </div>
          {ownerView && scope === "all" && <CustomerDashboard data={dashboard} approvedAnswers={faqs.length} />}
        </Fold>
        <Fold name={SECTIONS} id="about-business" icon="✍️" title="About your business" testId="fold-own-words" summary={about ? about.replace(/\s+/g, " ").slice(0, 120) : "Introduce your business to customers"}>
          <section className={BODY} aria-label="About your business">
            <BusinessInfoForm about={about} />
            <Link href={`/u/${agent.handle}`} target="_blank" className="text-sm text-accent underline">Preview your public page</Link>
          </section>
        </Fold>
        <Fold name={SECTIONS} id="business-information" icon="📋" title="Business information" testId="fold-book" summary={ways.length ? `${plural(ways.length, "customer action")} · contact, booking and ordering` : "Hours, address and ways customers can reach you"}>
          <section className={BODY} aria-label="Business information">
            <BusinessDetailsForm hours={details.hours} address={details.address} fromWebsite={Boolean(site?.live_at && (info.hours === undefined || info.address === undefined))} />
            <div id="book-or-order" className="scroll-mt-40 border-t border-border pt-4">
              <h3 className="mb-2 font-medium">Customer actions</h3>
              <p className="hint mb-3">Add booking, ordering and contact options or create your own labelled buttons. Your agent offers relevant options; customers complete actions directly with your business.</p>
              <WaysEditor initial={ways} />
            </div>
          </section>
        </Fold>
        <Fold name={SECTIONS} id="website-documents" icon="🌐" title="Website & documents" testId="fold-documents" summary={documentsSummary} badge={{ count: changeList.length, tone: "new" }}>
          <section className={BODY} aria-label="Website and documents">
            <span id="knows" />
            <div id="website" className="scroll-mt-40">
              {siteError ? <p role="alert" className="text-sm text-danger">Your website connection could not be loaded. Refresh this page before adding another.</p> : <WebsiteCard
                key={`${agent.id}:${site?.url ?? initialWebsite}`}
                site={site ? { domain: site.domain, url: site.url, status: site.status, pagesRead: site.pages_read, lastReadAt: site.last_read_at, lastSuccessAt: site.last_success_at, autoRefresh: site.auto_refresh, live: Boolean(site.live_at), warning: site.warning, error: site.error, verifyToken: site.verify_token } : null}
                lookup={(agent.business_info as { lookup?: boolean } | null)?.lookup !== false}
                verified={Boolean(site && agent.verified_domain === site.domain)}
                canVerifyByEmail={Boolean(site && emailProofEnforced() && email.confirmed && verifiesByEmail(email.address, site.domain))}
                initialValue={initialWebsite}
                initialError={!site && initialWebsite ? "Your website address is saved. Retry the connection below." : !site && website_error ? "Your website could not be connected. Enter its address below to retry." : undefined}
              />}
            </div>
            {changeList.length > 0 && <div data-testid="site-changes" className="space-y-3 rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-3"><h3 className="font-medium">Website updates</h3><ActionButton action={clearSiteChangesAction} label="Clear" /></div>
              <ul>{changeList.map((change) => <li key={change.id} className="py-2 text-sm" data-testid="site-change">{change.text}<span className="block text-xs text-muted">{dayBucket(change.created_at)}</span></li>)}</ul>
            </div>}
            <div id="links" className="scroll-mt-40 space-y-3 border-t border-border pt-4">
              <h3 className="font-medium">Additional documents &amp; links</h3>
              <p className="hint">Add a menu, price list or other material beyond your connected website. Each source is stored once, with its own visibility.</p>
              {sourcesError ? <p role="alert" className="text-sm text-danger">Documents could not be loaded. Refresh to try again.</p> : <SourcesManager sources={sources} />}
            </div>
            <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm font-medium">Customer-only information</summary><div className="pt-3"><BusinessInfoForm mode="customers" customers={info.customers ?? ""} /></div></details>
          </section>
        </Fold>
        <Fold name={SECTIONS} id="questions-answers" icon="💬" title="Questions & Answers" testId="fold-faqs" summary={faqs.length ? `${plural(faqs.length, "approved answer")}` : "Add the questions customers ask most"}>
          <section className={BODY} aria-label="Questions and answers">
            <p className="hint">Your approved reusable answers. General answers from your team are added here only when you choose to publish them.</p>
            <QuestionsAnswers faqs={faqs} />
          </section>
        </Fold>
        <Fold name={SECTIONS} id="staff-access" icon="👥" title="Staff & access" summary="Your team, invitations and permissions" testId="fold-staff"><div className={BODY}><StaffSection /></div></Fold>
        <Fold name={SECTIONS} id="share" icon="📷" title="Share your business" testId="fold-qr" summary="Your public page, customer QR code and printable poster">
          <section className={BODY} aria-label="Share your business">
            <p className="hint">Share your page or display its QR code so customers can ask your agent questions.</p>
            <p className="break-all text-sm text-muted">/u/{agent.handle}</p>
            <div className="flex flex-wrap gap-2"><Link href={`/u/${agent.handle}`} className="btn-ghost" data-testid="see-your-page">See your page</Link><Link href="/print/qr" className="btn-primary">Print poster</Link></div>
          </section>
        </Fold>
        {places.length > 0 && (
          <Fold
            name={SECTIONS}
            icon="👥"
            title="Groups and communities"
            testId="fold-places"
            badge={{ count: invites, tone: "new" }}
            summary={[
              groupsCount ? plural(groupsCount, "group") : "",
              communitiesCount ? plural(communitiesCount, "community", "communities") : "",
              invites ? `${plural(invites, "invitation")} waiting` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          >
            <section className={BODY} aria-label="Groups and communities">
              <p className="hint">
                Where people can mention @{agent.handle}. Your agent only sees the messages that mention it, answers from your public information (never
                “For customers only”) and never posts on its own.
              </p>
              <ul className="divide-y divide-border">
                {places.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2 py-2" data-testid="placement">
                    <span className="min-w-0 flex-1 text-sm">
                      {p.conversation_id ? "👥" : "🏟️"} {p.name}
                      <span className="block text-xs text-muted">
                        {p.conversation_id ? "Group" : p.status === "invited" ? "Community · invited you to be an official partner" : "Community · official partner"}
                      </span>
                    </span>
                    {p.status === "invited" ? (
                      <>
                        <ActionButton action={answerPartnerInviteAction.bind(null, p.id, true)} label="Accept" variant="btn-primary" />
                        <ActionButton action={answerPartnerInviteAction.bind(null, p.id, false)} label="Decline" />
                      </>
                    ) : (
                      <ActionButton action={leavePlacementAction.bind(null, p.id)} label="Leave" />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </Fold>
        )}
      </div>
    </div>
  );
}
