import { createClient } from "@/lib/supabase/server";
import { CATEGORY_LABELS, isRequestableCategory } from "@/lib/policy/disclosure";
import { inboxPayloadOf } from "@/lib/plans/inbox";
import type { IntroductionPayload } from "@/lib/people/introductions";
import { LocalTime } from "@/components/LocalTime";
import { InboxItemForm, type InboxField } from "./InboxItemForm";
import { QuestionForm } from "./QuestionForm";
import { IntroductionForm } from "./IntroductionForm";
import { GroupInviteForm } from "./GroupInviteForm";

type Kind = "info_request" | "question" | "introduction" | "group_invite";

/**
 * Things only you can decide, as cards with buttons: an agent asking for
 * information you didn't set to share, a contact's question, an introduction,
 * a group invite. Shown pinned at the top of My Agent ("Needs your answer"),
 * and the relevant ones in Contacts and Groups. Renders nothing when empty.
 */
export async function OpenRequests({ title, kinds, hint }: { title: string; kinds?: Kind[]; hint?: string }) {
  const supabase = await createClient();
  // RLS: only this user's own requests and own facts.
  let query = supabase.from("inbox_items").select("*").eq("status", "open").order("created_at", { ascending: true }).limit(30);
  if (kinds) query = query.in("kind", kinds);
  const [{ data: items }, { data: agents }, { data: facts }] = await Promise.all([
    query,
    supabase.from("agents").select("id, handle, display_name, avatar"),
    supabase.from("agent_facts").select("category, value, disclosure"),
  ]);
  if (!items?.length) return null;
  const byId = new Map((agents ?? []).map((a) => [a.id, a]));

  return (
    <section className="rounded-2xl border-2 border-accent bg-accent-soft/40 p-3" aria-label={title} data-testid="open-requests">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        🔔 {title} <span className="rounded-full bg-accent px-2 text-xs text-white dark:text-black">{items.length}</span>
      </h2>
      {hint && <p className="mb-2 text-xs text-muted">{hint}</p>}
      <ul className="space-y-3">
        {items.map((item) => {
          const from = item.from_agent ? byId.get(item.from_agent) : undefined;
          const who = from ? `${from.avatar} @${from.handle}` : "Someone";
          const when = <LocalTime iso={item.created_at} />;

          if (item.kind === "group_invite") {
            const invite = item.payload as { title?: string };
            return (
              <li key={item.id} className="card space-y-3" data-testid="inbox-item">
                <p className="text-sm">
                  👥 <b>{from?.display_name ?? "Someone"}</b> wants to add you to the group <b>“{invite.title ?? "a group"}”</b>.
                </p>
                <p className="hint">{when} · You chose to approve group invites yourself (Settings).</p>
                <GroupInviteForm itemId={item.id} />
              </li>
            );
          }

          if (item.kind === "introduction") {
            const intro = item.payload as unknown as IntroductionPayload;
            const other = byId.get(intro.other_agent);
            return (
              <li key={item.id} className="card space-y-3" data-testid="inbox-item">
                <div>
                  <p className="text-sm">
                    🤝 <b>{from?.display_name ?? "A friend"}</b> wants to introduce you to{" "}
                    <b>
                      {other?.avatar} {other?.display_name ?? "someone"}
                    </b>{" "}
                    <span className="text-muted">@{other?.handle}</span>
                  </p>
                  {intro.note && <p className="mt-1 rounded-lg bg-accent-soft px-3 py-2 text-sm">“{intro.note}”</p>}
                  <p className="hint mt-1">{when}</p>
                </div>
                <IntroductionForm itemId={item.id} name={other?.display_name ?? "them"} />
              </li>
            );
          }

          const payload = inboxPayloadOf(item);
          if (payload.kind === "question") {
            return (
              <li key={item.id} className="card space-y-3" data-testid="inbox-item">
                <div>
                  <p className="text-sm">
                    <b>{who}</b> asks you:
                  </p>
                  <p className="mt-1 rounded-lg bg-accent-soft px-3 py-2 text-sm">“{payload.question}”</p>
                  <p className="hint mt-1">
                    {when} · Only @{from?.handle ?? "they"} will see your answer.
                  </p>
                </div>
                <QuestionForm itemId={item.id} />
              </li>
            );
          }

          const fields: InboxField[] = payload.categories.filter(isRequestableCategory).map((category) => {
            const own = facts?.find((f) => f.category === category);
            return {
              category,
              label: CATEGORY_LABELS[category],
              // Prefill from the owner's own info (private values included: only the owner sees this).
              value: payload.shareable[category] ?? own?.value ?? "",
              alreadyShared: Boolean(payload.shareable[category]),
              required: category === "availability",
            };
          });
          return (
            <li key={item.id} className="card space-y-3" data-testid="inbox-item">
              <div>
                <p className="text-sm">
                  <b>{who}&apos;s agent</b> is organising <b>{payload.event}</b> ({payload.window}) and asks for your{" "}
                  {fields.map((f) => f.label.toLowerCase()).join(" and ")}.
                </p>
                <p className="hint">{when} · Your agent didn&apos;t answer because some of this isn&apos;t set to be shared.</p>
              </div>
              <InboxItemForm itemId={item.id} fields={fields} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
