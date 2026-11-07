import Link from "next/link";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionButton } from "@/components/ActionButton";
import { acceptContact, blockContact, openAgentChat, openDirectMessage, removeContact } from "../actions";

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

  return (
    <div className="space-y-6">
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
