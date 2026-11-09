import Link from "next/link";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionButton } from "@/components/ActionButton";
import { acceptContact, blockContact, openAgentChat, openDirectMessage, removeContact } from "../actions";
import { LocalTime } from "@/components/LocalTime";
import { liveQr, permanentQr, personalLink } from "@/lib/people/links";
import { ShareLink } from "./ShareLink";
import { IntroduceForm } from "./IntroduceForm";
import { PeopleTabs } from "@/components/PeopleTabs";
import { OpenRequests } from "@/components/requests/OpenRequests";
import { Fold } from "@/components/Fold";
import { AgentName } from "@/components/AgentName";

export default async function ContactsPage() {
  const { agent } = await requireAgent();
  const supabase = await createClient();
  const [{ data: contacts }, { data: agents }] = await Promise.all([
    supabase.from("contacts").select("*").order("created_at", { ascending: false }),
    supabase.from("agents").select("id, handle, display_name, avatar, type"),
  ]);
  const byId = new Map((agents ?? []).map((a) => [a.id, a]));
  const rows = (contacts ?? []).map((c) => ({
    ...c,
    other: byId.get(c.requester_agent === agent.id ? c.addressee_agent : c.requester_agent)!,
    incoming: c.addressee_agent === agent.id,
  }));

  const incoming = rows.filter((r) => r.status === "pending" && r.incoming);
  const outgoing = rows.filter((r) => r.status === "pending" && !r.incoming);
  const accepted = rows.filter((r) => r.status === "accepted");
  const blocked = rows.filter((r) => r.status === "blocked" && r.blocked_by === agent.id);
  // Introductions you said yes to, still waiting for the other person (RLS: ones you're in).
  const { data: intros } = await supabase.from("introductions").select("*").eq("status", "pending");
  const waitingIntros = (intros ?? [])
    .filter((i) => (i.a_agent === agent.id && i.a_answer === "accepted") || (i.b_agent === agent.id && i.b_answer === "accepted"))
    .map((i) => ({ id: i.id, other: byId.get(i.a_agent === agent.id ? i.b_agent : i.a_agent), introducer: byId.get(i.introducer_agent) }));
  const link = personalLink(agent.handle);
  // People: a live code that changes every 10 minutes. Businesses: a permanent code to print.
  const isBusiness = agent.type === "business";
  const businessCount = accepted.filter((r) => r.other.type === "business").length;
  const qr = isBusiness ? { ...(await permanentQr(agent.handle)), expiresAt: null } : await liveQr(agent.id, agent.handle);

  return (
    <div className="space-y-6">
      <PeopleTabs active="contacts" />
      <OpenRequests title="Introductions" kinds={["introduction"]} hint="A friend thinks you should meet. You're connected only if you both say yes." />
      {waitingIntros.length > 0 && (
        <section className="card space-y-1" aria-label="Waiting introductions">
          {waitingIntros.map((i) => (
            <p key={i.id} className="text-sm text-muted" data-testid="intro-waiting">
              👍 You said yes to meeting {i.other?.avatar} {i.other?.display_name}
              {i.introducer ? ` (introduced by ${i.introducer.display_name})` : ""}. Waiting for them to say yes too.
            </p>
          ))}
        </section>
      )}
      {incoming.length > 0 && (
        <Section title="Requests">
          {incoming.map((r) => (
            <Row key={r.id} agent={r.other}>
              <ActionButton action={acceptContact.bind(null, r.id)} label="Accept" variant="btn-primary" />
              <ActionButton action={removeContact.bind(null, r.id)} label="Decline" />
              <ActionButton action={blockContact.bind(null, r.id)} label="Block" variant="btn-danger" />
            </Row>
          ))}
        </Section>
      )}

      {/* Your contacts, adding people and introductions: tap a section to open it (one at a time). */}
      <div className="space-y-3">
        <Fold
          name="contacts-sections"
          open
          icon="👥"
          title="Contacts"
          testId="fold-contacts"
          summary={[
            `${accepted.length} ${accepted.length === 1 ? "contact" : "contacts"}`,
            ...(businessCount ? [`${businessCount} ${businessCount === 1 ? "business" : "businesses"}`] : []),
            ...(outgoing.length ? [`${outgoing.length} sent ${outgoing.length === 1 ? "request" : "requests"}`] : []),
            ...(blocked.length ? [`${blocked.length} blocked`] : []),
          ].join(" · ")}
        >
          {accepted.length === 0 && (
            <p className="px-5 py-4 text-sm text-muted">No contacts yet. <Link className="text-accent underline" href="/discover">Find people</Link>.</p>
          )}
          {/* People first, then businesses, each under its own heading. */}
          {(
            [
              ["People", accepted.filter((r) => r.other.type !== "business")],
              ["Businesses", accepted.filter((r) => r.other.type === "business")],
            ] as const
          ).map(([title, rows]) =>
            rows.length ? (
              <SubList key={title} title={title} testId={`contacts-${title.toLowerCase()}`}>
                {rows.map((r) => (
                  <Row key={r.id} agent={r.other}>
                    {/* A business: its agent comes first; Message stays the main (green) action, as for people. */}
                    {r.other.type === "business" && <ActionButton action={openAgentChat.bind(null, r.other.id)} label="Ask agent" />}
                    <ActionButton action={openDirectMessage.bind(null, r.other.id)} label="Message" variant="btn-primary" />
                    <details className="relative">
                      <summary className="btn-ghost cursor-pointer list-none">⋯</summary>
                      <div className="absolute right-0 z-10 mt-1 flex flex-col gap-1 rounded-xl border border-border bg-surface p-2 shadow">
                        <ActionButton action={removeContact.bind(null, r.id)} label="Remove" />
                        <ActionButton action={blockContact.bind(null, r.id)} label="Block" variant="btn-danger" />
                      </div>
                    </details>
                  </Row>
                ))}
              </SubList>
            ) : null,
          )}
          {outgoing.length > 0 && (
            <SubList title="Sent requests">
              {outgoing.map((r) => (
                <Row key={r.id} agent={r.other}>
                  <ActionButton action={removeContact.bind(null, r.id)} label="Withdraw" />
                </Row>
              ))}
            </SubList>
          )}
          {blocked.length > 0 && (
            <SubList title="Blocked">
              {blocked.map((r) => (
                <Row key={r.id} agent={r.other}>
                  <ActionButton action={removeContact.bind(null, r.id)} label="Unblock" />
                </Row>
              ))}
            </SubList>
          )}
        </Fold>

        {!agent.guest && (
          <Fold
            name="contacts-sections"
            icon="📲"
            title="Add people in a tap"
            testId="fold-add-people"
            summary={isBusiness ? "Share your link, or print your QR code for customers" : "Share your link, or let a friend scan your code"}
          >
            <div className="space-y-4 px-5 py-5 sm:px-6" aria-label="Your link">
              <p className="text-sm text-muted">Send your link to anyone (they&apos;ll send you a request), or let a friend next to you scan your code.</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-accent-soft px-3 py-2 text-sm" data-testid="personal-link">{link}</code>
                <ShareLink url={link} text={`Add me on AGENTME: @${agent.handle}`} label="Share my link" />
              </div>
              <details className="group/qr">
                <summary className="btn-ghost inline-flex cursor-pointer list-none">📷 Show my QR code</summary>
                <div className="mt-3 flex flex-col items-center gap-2 text-center">
                  {/* Generated server-side from our own URL; white background so phones can scan it in dark mode. */}
                  <div className="w-56 rounded-2xl bg-white p-2" data-testid="qr-code" data-url={qr.url} dangerouslySetInnerHTML={{ __html: qr.svg }} />
                  {qr.expiresAt ? (
                    <p className="hint max-w-xs">
                      Scanning this connects you straight away, no request needed. It changes every 10 minutes (this one works until{" "}
                      <LocalTime iso={qr.expiresAt.toISOString()} />
                      ), so a photo of it can&apos;t be reused later.
                    </p>
                  ) : (
                    <>
                      <p className="hint max-w-xs">
                        This code never changes, so use it anywhere you meet customers: in your shop, on your website or on social media. One scan and
                        they can ask your agent anything, or become a customer.
                      </p>
                      <Link href="/print/qr" className="btn-primary" data-testid="print-poster">🖨️ Print poster</Link>
                    </>
                  )}
                </div>
              </details>
            </div>
          </Fold>
        )}

        {accepted.length >= 2 && (
          <Fold name="contacts-sections" icon="🤝" title="Introduce two friends" testId="fold-introduce" summary="Their agents ask each of them; connected only if both say yes">
            <div className="space-y-3 px-5 py-5 sm:px-6" aria-label="Introduce">
              <p className="text-sm text-muted">Pick two contacts who should meet. Their agents ask each of them, and they&apos;re connected only if both say yes.</p>
              <IntroduceForm people={accepted.map((r) => r.other)} />
            </div>
          </Fold>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-muted">{title}</h2>
      <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">{children}</ul>
    </section>
  );
}

/** A labelled list inside the Contacts section (people, businesses, sent requests, blocked). */
function SubList({ title, testId, children }: { title: string; testId?: string; children: React.ReactNode }) {
  return (
    // The first list in the section needs no line above it (the section already has one).
    <div className="border-t border-border first:border-t-0" data-testid={testId}>
      <p className="px-5 pt-4 text-xs font-semibold uppercase tracking-wide text-muted sm:px-6">{title}</p>
      <ul className="divide-y divide-border">{children}</ul>
    </div>
  );
}

function Row({ agent, children }: { agent: { avatar: string; display_name: string; handle: string; type: string }; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3 sm:px-6">
      <AgentName agent={agent} className="text-2xl">{agent.avatar}</AgentName>
      <span className="min-w-0 flex-1">
        <AgentName agent={agent} className="block font-medium" pageHint>{agent.display_name}</AgentName>
        <span className="block text-xs text-muted">@{agent.handle}{agent.type === "business" ? " · Business" : ""}</span>
      </span>
      <span className="flex gap-2">{children}</span>
    </li>
  );
}
