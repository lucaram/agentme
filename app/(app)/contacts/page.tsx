import Link from "next/link";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionButton } from "@/components/ActionButton";
import { acceptContact, blockContact, openAgentChat, openDirectMessage, removeContact } from "../actions";
import { LocalTime } from "@/components/LocalTime";
import { liveQr, personalLink } from "@/lib/people/links";
import { ShareLink } from "./ShareLink";
import { IntroduceForm } from "./IntroduceForm";
import { PeopleTabs } from "@/components/PeopleTabs";
import { OpenRequests } from "@/components/requests/OpenRequests";

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
  const link = personalLink(agent.handle);
  const qr = await liveQr(agent.id, agent.handle);

  return (
    <div className="space-y-6">
      <PeopleTabs active="contacts" />
      <OpenRequests title="Introductions" kinds={["introduction"]} hint="A friend thinks you should meet. You're connected only if you both say yes." />
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

      {!agent.guest && (
        <section className="card space-y-3" aria-label="Your link">
          <div>
            <h2 className="font-semibold">Add people in a tap</h2>
            <p className="hint">Send your link to anyone (they&apos;ll send you a request), or let a friend next to you scan your code.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-accent-soft px-2 py-1.5 text-sm" data-testid="personal-link">{link}</code>
            <ShareLink url={link} text={`Add me on AGENTME: @${agent.handle}`} label="Share my link" />
          </div>
          <details className="group">
            <summary className="btn-ghost inline-flex cursor-pointer list-none">📷 Show my QR code</summary>
            <div className="mt-3 flex flex-col items-center gap-2 text-center">
              {/* Generated server-side from our own URL; white background so phones can scan it in dark mode. */}
              <div className="w-56 rounded-2xl bg-white p-2" data-testid="qr-code" data-url={qr.url} dangerouslySetInnerHTML={{ __html: qr.svg }} />
              <p className="hint max-w-xs">
                Scanning this connects you straight away, no request needed. It changes every 10 minutes (this one works until{" "}
                <LocalTime iso={qr.expiresAt.toISOString()} />
                ), so a photo of it can&apos;t be reused later.
              </p>
            </div>
          </details>
        </section>
      )}

      <Section title="Contacts">
        {accepted.length === 0 && (
          <p className="px-4 py-3 text-sm text-muted">No contacts yet. <Link className="text-accent underline" href="/discover">Find people</Link>.</p>
        )}
        {accepted.map((r) => (
          <Row key={r.id} agent={r.other}>
            <ActionButton action={openDirectMessage.bind(null, r.other.id)} label="Message" variant="btn-primary" />
            {r.other.type === "business" && <ActionButton action={openAgentChat.bind(null, r.other.id)} label="Ask agent" />}
            <details className="relative">
              <summary className="btn-ghost cursor-pointer list-none">⋯</summary>
              <div className="absolute right-0 z-10 mt-1 flex flex-col gap-1 rounded-xl border border-border bg-surface p-2 shadow">
                <ActionButton action={removeContact.bind(null, r.id)} label="Remove" />
                <ActionButton action={blockContact.bind(null, r.id)} label="Block" variant="btn-danger" />
              </div>
            </details>
          </Row>
        ))}
      </Section>

      {accepted.length >= 2 && (
        <section className="card space-y-3" aria-label="Introduce">
          <div>
            <h2 className="font-semibold">🤝 Introduce two friends</h2>
            <p className="hint">Their agents ask each of them, and they&apos;re connected only if both say yes.</p>
          </div>
          <IntroduceForm people={accepted.map((r) => r.other)} />
        </section>
      )}

      {outgoing.length > 0 && (
        <Section title="Sent requests">
          {outgoing.map((r) => (
            <Row key={r.id} agent={r.other}>
              <ActionButton action={removeContact.bind(null, r.id)} label="Withdraw" />
            </Row>
          ))}
        </Section>
      )}

      {blocked.length > 0 && (
        <Section title="Blocked">
          {blocked.map((r) => (
            <Row key={r.id} agent={r.other}>
              <ActionButton action={removeContact.bind(null, r.id)} label="Unblock" />
            </Row>
          ))}
        </Section>
      )}
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

function Row({ agent, children }: { agent: { avatar: string; display_name: string; handle: string; type: string }; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="text-2xl">{agent.avatar}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{agent.display_name}</span>
        <span className="block text-xs text-muted">@{agent.handle}{agent.type === "business" ? " · Business" : ""}</span>
      </span>
      <span className="flex gap-2">{children}</span>
    </li>
  );
}
