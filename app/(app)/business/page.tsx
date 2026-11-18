import { createHash } from "node:crypto";
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
import { Tabs } from "@/components/Tabs";
import { SectionLink } from "@/components/SectionLink";
import { ShareLink } from "../contacts/ShareLink";
import { PublicPageEditor } from "./PublicPageEditor";
import { pageSettings } from "@/lib/business/public-page";
import { currentCover } from "@/lib/business/cover-server";
import { permanentQr } from "@/lib/people/links";
import { OpenFromHash } from "@/components/OpenFromHash";
import { BusinessInfoForm, BusinessDetailsForm, SourcesManager } from "./BusinessForms";
import { QuestionsAnswers } from "./QuestionsAnswers";
import { offeringsOf } from "@/lib/business/offerings";
import { facilityName, groupItems, readingPrices, readingSource } from "@/lib/business/offerings-shared";
import { Thinking } from "@/components/Thinking";
import { AddBusinessIntro } from "./AddBusinessIntro";
import { WaysEditor } from "./WaysEditor";
import { TestAgent } from "./TestAgent";
import { waysOf } from "@/lib/business/booking";
import { businessDescription, publicBusinessDetails } from "@/lib/business/details";
import { ActionButton } from "@/components/ActionButton";
import { answerPartnerInviteAction, leavePlacementAction } from "../social-actions";
import { linkKey, linksIn } from "@/lib/business/extract";
import { WebsiteCard } from "./WebsiteCard";
import { PagedList } from "@/components/PagedList";
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
  if (user.businessRole === "staff") return <div className="space-y-5"><RealtimeRefresh channel={`staff-business-${user.id}`} tables={["business_queue_versions", "presence_preferences"]} /><OpenFromHash /><h1 className="text-lg font-semibold">My Business</h1><p className="text-sm text-muted">Handle customer requests in My Agent. {requiresPublicationApproval ? "Suggest reusable answers for an Owner or Manager to approve." : "Add eligible general answers to Questions & Answers after the publication check."}</p><form action={openMyAgent}><button className="btn-primary">Go to My Agent</button></form><Fold name={SECTIONS} id="agent-knows" icon="🧠" title="What your agent knows" testId="fold-knows" summary={`About · ${info.faqs?.length ?? 0} approved answers`}><Tabs label="What your agent knows" tabs={[{ id: "about-business", label: "About", testId: "fold-own-words" }, { id: "questions-answers", label: "Q&A", testId: "fold-faqs", badge: { count: info.faqs?.length ?? 0, tone: "total" } }]}><div className={BODY}><p className="whitespace-pre-wrap text-sm">{about}</p>{info.hours && <p className="text-sm">{info.hours}</p>}</div><div className={`${BODY} space-y-4`}><PagedList className="space-y-4">{info.faqs?.map((faq, index) => <div key={index} className="text-sm"><p className="font-medium">{faq.q}</p><p className="text-muted">{faq.a}</p></div>)}</PagedList><BusinessAnswerSuggestion approvalRequired={requiresPublicationApproval} /></div></Tabs></Fold><Fold name={SECTIONS} id="staff-access" icon="👥" title="Staff & access" summary="Your team, work availability and permissions" testId="fold-staff"><div className={BODY}><StaffSection /></div></Fold></div>;
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
  // Prices & facilities, read from the website and documents (owners and managers only: staff see a different page).
  const offerings = await offeringsOf(agent.id);
  // Prices and facilities being read right now (a document being fetched counts: its prices come next).
  const readingOfferings = (allRows ?? []).some((s) => (s.origin === "link" ? readingSource(s) : readingPrices(s)));
  // Website pages that prices were read from, and whether they're being read now.
  const sitePages = (allRows ?? []).filter((s) => s.origin === "site");
  const pricedUrls = new Set(offerings.prices.filter((p) => !p.hidden && !p.added && p.source_url).map((p) => p.source_url));
  const pricePages = sitePages.filter((s) => pricedUrls.has(s.url)).length;
  const siteReadingPrices = sitePages.some((s) => readingPrices(s));
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
    id: source.id, url: source.url, visibility: source.visibility, status: source.status, kind: source.kind, error: source.error, offerings_error: source.offerings_error, reading_prices: readingPrices(source), last_read_at: source.last_read_at,
    words: (source.content ?? "").split(/\s+/).filter(Boolean).length, preview: (source.content ?? "").slice(0, 1500),
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
  const publicPage = { settings: pageSettings(agent.business_info), cover: await currentCover(agent.id), qr: await permanentQr(agent.handle) };
  const { page: _look, ...shownInfo } = (agent.business_info ?? {}) as Record<string, unknown>;
  void _look;
  const previewRevision = createHash("sha256")
    .update(JSON.stringify([agent.display_name, agent.avatar, agent.verified_domain, agent.bio, shownInfo, site?.live_at ?? null, site?.learned ?? null, site?.hidden ?? null]))
    .digest("hex")
    .slice(0, 16);
  const knowsSummary = [about ? "About" : "", details.hours || details.address ? "Details" : "", ways.length ? plural(ways.length, "customer action") : "", offerings.prices.length ? plural(groupItems(offerings.prices).filter((x) => !x.hidden).length, "price") : "", documentsSummary, faqs.length ? plural(faqs.length, "answer") : ""].filter(Boolean).join(" · ");

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
        <Fold name={SECTIONS} id="agent-knows" icon="🧠" title="What your agent knows" testId="fold-knows" summary={site?.status === "reading" ? <Thinking label="Reading your website" className="text-accent" /> : readingOfferings ? <Thinking label="Reading prices" className="text-accent" /> : knowsSummary} badge={{ count: changeList.length, tone: "new" }}>
          <Tabs
            label="What your agent knows"
            tabs={[
              { id: "about-business", label: "About", testId: "fold-own-words" },
              { id: "business-information", label: "Details", testId: "fold-book" },
              { id: "prices-facilities", label: "Prices & facilities", testId: "fold-offerings" },
              { id: "website-documents", label: "Website & documents", testId: "fold-documents", badge: { count: changeList.length, tone: "new" } },
              { id: "questions-answers", label: "Q&A", testId: "fold-faqs", badge: { count: faqs.length, tone: "total" } },
            ]}
          >
            <section className={BODY} aria-label="About your business">
              <BusinessInfoForm about={about} />
              <Link href={`/u/${agent.handle}`} target="_blank" className="text-sm text-accent underline">See your public page</Link>
            </section>
            <section className={BODY} aria-label="Business information">
              <BusinessDetailsForm hours={details.hours} address={details.address} fromWebsite={Boolean(site?.live_at && (info.hours === undefined || info.address === undefined))} />
              <div id="book-or-order" className="scroll-mt-40 border-t border-border pt-4">
                <h3 className="mb-2 font-medium">Customer actions</h3>
                <p className="mb-3 text-sm" data-testid="taps-explained">
                  <b>What customers can tap.</b> Links your agent shares with customers as buttons, on your public page and in chats. Your agent doesn&apos;t read them.
                </p>
                <WaysEditor initial={ways} />
              </div>
            </section>
            <section className={BODY} aria-label="Prices and facilities">
              {/* Like Settings: a row each, opening its own page. */}
              <nav aria-label="Prices and facilities" className="space-y-2">
                {[
                  { href: "/business/prices", icon: "💷", title: "Prices", testId: "prices-link", summary: (() => { const items = groupItems(offerings.prices).filter((x) => !x.hidden); const products = items.filter((x) => x.kind === "product").length; const services = items.length - products; const from = [...new Set(items.flatMap((x) => (x.source_label && !x.added ? [x.source_label] : [])))]; return items.length ? `${[products ? plural(products, "product") : "", services ? plural(services, "service") : ""].filter(Boolean).join(" · ")}${from.length ? ` · from ${from.slice(0, 2).join(", ")}${from.length > 2 ? ` and ${from.length - 2} more` : ""}` : ""}` : "None yet · products and services from your menu or price list"; })() },
                  { href: "/business/facilities", icon: "🏷️", title: "Facilities", testId: "facilities-link", summary: (() => { const shownFacilities = offerings.facilities.filter((x) => !x.hidden); const yes = shownFacilities.filter((x) => x.status === "yes").map((x) => facilityName(x).label); return shownFacilities.length ? `${yes.length ? yes.slice(0, 3).join(", ") + (yes.length > 3 ? ` and ${yes.length - 3} more` : "") : "None available"}${shownFacilities.some((x) => !x.confirmed) ? " · some to check" : ""}` : "None yet · parking, step-free access, your own…"; })() },
                ].map((r) => (
                  <Link key={r.href} href={r.href} className="card flex items-center gap-3 hover:bg-accent-soft" data-testid={r.testId}>
                    <span className="text-xl" aria-hidden>{r.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{r.title}</span>
                      <span className="block truncate text-xs text-muted">{readingOfferings ? <Thinking label={r.href.endsWith("prices") ? "Reading prices" : "Reading facilities"} className="text-accent" /> : r.summary}</span>
                    </span>
                    <span className="text-accent" aria-hidden>›</span>
                  </Link>
                ))}
              </nav>
            </section>
            <section className={BODY} aria-label="Website and documents">
              <span id="knows" />
              <p className="text-sm" data-testid="knows-explained">
                <b>What your agent knows.</b> Your agent reads your website and these documents, and uses what it learns to answer customers.
              </p>
              <div id="website" className="scroll-mt-40">
                {siteError ? <p role="alert" className="text-sm text-danger">Your website connection could not be loaded. Refresh this page before adding another.</p> : <WebsiteCard
                  key={`${agent.id}:${site?.url ?? initialWebsite}`}
                  site={site ? { domain: site.domain, url: site.url, status: site.status, pagesRead: site.pages_read, lastReadAt: site.last_read_at, lastSuccessAt: site.last_success_at, autoRefresh: site.auto_refresh, live: Boolean(site.live_at), pricePages, readingPrices: siteReadingPrices, warning: site.warning, error: site.error, verifyToken: site.verify_token } : null}
                  lookup={(agent.business_info as { lookup?: boolean } | null)?.lookup !== false}
                  verified={Boolean(site && agent.verified_domain === site.domain)}
                  canVerifyByEmail={Boolean(site && emailProofEnforced() && email.confirmed && verifiesByEmail(email.address, site.domain))}
                  initialValue={initialWebsite}
                  notice={site ? undefined : website_error ? "We couldn't connect the website you gave at sign-up. Check the address and try again." : initialWebsite ? "We couldn't connect your website yet. Check the address and try again." : undefined}
                />}
              </div>
              {changeList.length > 0 && <div data-testid="site-changes" className="space-y-3 rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-3"><h3 className="font-medium">Website updates</h3><ActionButton action={clearSiteChangesAction} label="Clear" /></div>
                <ul>{changeList.map((change) => <li key={change.id} className="py-2 text-sm" data-testid="site-change">{change.text}<span className="block text-xs text-muted">{dayBucket(change.created_at)}</span></li>)}</ul>
              </div>}
              <div id="links" className="scroll-mt-40 space-y-3 border-t border-border pt-4">
                <h3 className="font-medium">Additional documents &amp; links</h3>
                <p className="hint">Pages, PDFs and photos your agent reads and learns from, such as a menu or price list. Customers don&apos;t see them as buttons.</p>
                {sourcesError ? <p role="alert" className="text-sm text-danger">Documents could not be loaded. Refresh to try again.</p> : <SourcesManager sources={sources} />}
              </div>
              <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm font-medium">Customer-only information</summary><div className="pt-3"><BusinessInfoForm mode="customers" customers={info.customers ?? ""} /></div></details>
            </section>
            <section className={BODY} aria-label="Questions and answers">
              <p className="hint">Your approved reusable answers. General answers from your team are added here only when you choose to publish them.</p>
              <QuestionsAnswers faqs={faqs} />
            </section>
          </Tabs>
        </Fold>
        <Fold name={SECTIONS} id="staff-access" icon="👥" title="Staff & access" summary="Your team, invitations and permissions" testId="fold-staff"><div className={BODY}><StaffSection /></div></Fold>
        <Fold name={SECTIONS} id="share" icon="📷" title="Public page & sharing" testId="fold-qr" summary={`${publicPage.cover ? "Cover · " : ""}${publicPage.settings.accent ? `${publicPage.settings.accent[0].toUpperCase()}${publicPage.settings.accent.slice(1)} · ` : ""}Your page, QR code and printable poster`}>
          <section className={BODY} aria-label="Public page and sharing">
            <p className="hint">
              Every business has a public page: it&apos;s what your QR code and link open, and where customers ask your agent. It&apos;s built from what you&apos;ve already filled in.
            </p>
            <div className="space-y-3" data-testid="page-share">
              <h3 className="font-medium">Share</h3>
              <div className="flex flex-wrap items-start gap-4">
                <div className="w-36 shrink-0 rounded-xl border border-border bg-white p-2" aria-label="QR code for your page" role="img" dangerouslySetInnerHTML={{ __html: publicPage.qr.svg }} />
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="break-all font-mono text-sm" data-testid="page-url">{publicPage.qr.url}</p>
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/u/${agent.handle}`} className="btn-primary" data-testid="see-your-page">See your page</Link>
                    <ShareLink url={publicPage.qr.url} text={`Ask ${agent.display_name} anything`} label="Share link" variant="btn-ghost" />
                    <Link href="/print/qr" className="btn-ghost">Print poster</Link>
                  </div>
                  <p className="hint">The QR code never changes, so a printed poster keeps working whatever you change here.</p>
                </div>
              </div>
            </div>
            <div className="border-t border-border pt-4">
              <PublicPageEditor
                handle={agent.handle}
                revision={previewRevision}
                settings={publicPage.settings}
                cover={publicPage.cover}
                whereToChange={
                  <div data-testid="page-sources">
                    <h3 className="mb-2 text-sm font-medium">Where to change what&apos;s on it</h3>
                    <ul className="space-y-1.5 text-sm">
                      <li><Link href="/settings/profile" className="text-accent underline">Name and avatar</Link></li>
                      <li><SectionLink id="about-business" className="text-accent underline">Description</SectionLink></li>
                      <li><SectionLink id="business-information" className="text-accent underline">Opening hours and address</SectionLink></li>
                      <li><SectionLink id="book-or-order" className="text-accent underline">Book, order and contact buttons</SectionLink></li>
                      <li><SectionLink id="website-documents" className="text-accent underline">Website, documents and verified badge</SectionLink></li>
                    </ul>
                  </div>
                }
              />
            </div>
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
