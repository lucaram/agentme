import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { CATEGORY_LABELS, isRequestableCategory } from "@/lib/policy/disclosure";
import type { InboxPayload } from "@/lib/plans/inbox";
import { InboxItemForm, type InboxField } from "./InboxItemForm";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

export default async function InboxPage() {
  const { user } = await requireAgent();
  const supabase = await createClient();
  // RLS: only this user's own inbox and own facts.
  const [{ data: items }, { data: agents }, { data: facts }] = await Promise.all([
    supabase.from("inbox_items").select("*").order("created_at", { ascending: false }).limit(50),
    supabase.from("agents").select("id, handle, display_name, avatar"),
    supabase.from("agent_facts").select("category, value, disclosure"),
  ]);
  const byId = new Map((agents ?? []).map((a) => [a.id, a]));
  const open = (items ?? []).filter((i) => i.status === "open");
  const closed = (items ?? []).filter((i) => i.status !== "open").slice(0, 20);

  return (
    <div className="space-y-6">
      <RealtimeRefresh channel={`inbox-page-${user.id}`} tables={["inbox_items"]} />
      <div>
        <h1 className="text-lg font-semibold">Inbox</h1>
        <p className="text-xs text-muted">
          Requests your agent couldn&apos;t answer on its own because you haven&apos;t allowed it to share that information. Nothing is shared
          unless you choose to.
        </p>
      </div>

      {!open.length && <p className="card text-sm text-muted">Nothing needs your answer right now.</p>}
      <ul className="space-y-3">
        {open.map((item) => {
          const payload = item.payload as unknown as InboxPayload;
          const from = item.from_agent ? byId.get(item.from_agent) : undefined;
          const fields: InboxField[] = payload.categories.filter(isRequestableCategory).map((category) => {
            const own = facts?.find((f) => f.category === category);
            return {
              category,
              label: CATEGORY_LABELS[category],
              // Prefill from the owner's own info (private values included: only the owner sees this page).
              value: payload.shareable[category] ?? own?.value ?? "",
              alreadyShared: Boolean(payload.shareable[category]),
              required: category === "availability",
            };
          });
          return (
            <li key={item.id} className="card space-y-3" data-testid="inbox-item">
              <div>
                <p className="text-sm">
                  <b>{from ? `${from.avatar} @${from.handle}'s agent` : "An agent"}</b> is organising <b>{payload.event}</b> ({payload.window}) and asks
                  for your {fields.map((f) => f.label.toLowerCase()).join(" and ")}.
                </p>
                <p className="hint">{fmt(item.created_at)} · Your agent didn&apos;t answer because some of this isn&apos;t set to be shared.</p>
              </div>
              <InboxItemForm itemId={item.id} fields={fields} />
            </li>
          );
        })}
      </ul>

      {closed.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted">Earlier</h2>
          <ul className="divide-y divide-border rounded-2xl border border-border bg-surface text-sm">
            {closed.map((item) => {
              const payload = item.payload as unknown as InboxPayload;
              const from = item.from_agent ? byId.get(item.from_agent) : undefined;
              const label = { answered: "You answered", declined: "You declined", withdrawn: "No longer needed" }[item.status as "answered" | "declined" | "withdrawn"];
              return (
                <li key={item.id} className="flex justify-between gap-2 px-4 py-2">
                  <span>{from ? `@${from.handle}` : "An agent"} · {payload.event} ({payload.window})</span>
                  <span className="text-xs text-muted">{label}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
