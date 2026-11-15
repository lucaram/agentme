import { createClient } from "@/lib/supabase/server";
import { CATEGORY_LABELS, isRequestableCategory } from "@/lib/policy/disclosure";
import { inboxPayloadOf } from "@/lib/plans/inbox";
import type { IntroductionPayload } from "@/lib/people/introductions";
import { LocalTime } from "@/components/LocalTime";
import { StaffQuestionRead } from "@/components/chat/StaffQuestionRead";
import { InboxItemForm, type InboxField } from "./InboxItemForm";
import { QuestionForm } from "./QuestionForm";
import { IntroductionForm } from "./IntroductionForm";
import { GroupInviteForm } from "./GroupInviteForm";
import { z } from "zod";

type Kind = "info_request" | "question" | "introduction" | "group_invite";

/**
 * Things only you can decide, as cards with buttons: an agent asking for
 * information you didn't set to share, a contact's question, an introduction,
 * a group invite. Shown pinned at the top of My Agent ("Needs your answer"),
 * and the relevant ones in Contacts and Groups. Renders nothing when empty.
 */
export async function OpenRequests({ title, kinds, hint, excludeIds = [] }: { title: string; kinds?: Kind[]; hint?: string; excludeIds?: string[] }) {
  const supabase = await createClient();
  // RLS: only this user's own requests and own facts.
  const excluded = excludeIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const [{ data: rawItems }, { data: agents }, { data: facts }] = await Promise.all([
    supabase.rpc("open_owner_requests", { p_kinds: kinds ?? null, p_exclude: excluded }),
    supabase.from("agents").select("id, handle, display_name, avatar"),
    supabase.from("agent_facts").select("category, value, disclosure"),
  ]);
  const inviteIds = (rawItems ?? []).filter((item) => item.kind === "group_invite").map((item) => item.id);
  const { data: previewData } = inviteIds.length ? await supabase.rpc("group_invite_previews", { p_ids: inviteIds }) : { data: [] };
  const previews = z.array(z.object({ id: z.string(), title: z.string().nullable(), description: z.string().nullable(), members: z.number(), earlierHistory: z.boolean(), expires: z.string() })).safeParse(previewData).data ?? [];
  const previewsById = new Map(previews.map((preview) => [preview.id, preview]));
  const items = (rawItems ?? []).filter((item) => item.kind !== "group_invite" || previewsById.has(item.id));
  if (!items.length) return null;
  const byId = new Map((agents ?? []).map((a) => [a.id, a]));

  return (
    <section className="rounded-2xl border-2 border-accent bg-accent-soft/40 p-3" aria-label={title} data-testid="open-requests">
      <StaffQuestionRead ids={items.filter((item) => { const payload = inboxPayloadOf(item); return payload.kind === "question" && payload.business; }).map((item) => item.id)} />
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
            const invite = previewsById.get(item.id)!;
            return (
              <li key={item.id} className="card space-y-3" data-testid="inbox-item">
                <p className="text-sm">
                  👥 <b>{from?.display_name ?? "Someone"}</b> invited you to <b>“{invite.title ?? "a group"}”</b>.
                </p>
                {invite.description && <p className="text-sm text-muted">{invite.description}</p>}
                <p className="hint">{invite.members} {invite.members === 1 ? "member" : "members"} · {invite.earlierHistory ? "Earlier messages will be shared." : "Messages from joining, plus current shared plans and polls."}</p>
                <p className="hint">Expires <LocalTime iso={invite.expires} /> · Joining does not RSVP to an event.</p>
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
          if (payload.kind === "question" && payload.business) {
            return (
              <li key={item.id} className="card space-y-3" data-testid="inbox-item">
                <div>
                  <p className="text-sm">
                    🏪 <b>{who}</b> asked your business:
                  </p>
                  <p className="mt-1 rounded-lg bg-accent-soft px-3 py-2 text-sm" data-staff-question={item.id}>“{payload.question}”</p>
                  <p className="hint mt-1">
                    {when} · Your agent didn&apos;t find this in your business info. Your answer goes back to them, from the team.
                  </p>
                </div>
                <QuestionForm itemId={item.id} variant="business" faqEligible={payload.faq_eligible === true} />
              </li>
            );
          }
          if (payload.kind === "question" && payload.ask_around) {
            return (
              <li key={item.id} className="card space-y-3" data-testid="inbox-item">
                <div>
                  <p className="text-sm">
                    🔎 <b>{who}</b> is asking around:
                  </p>
                  <p className="mt-1 rounded-lg bg-accent-soft px-3 py-2 text-sm">“{payload.question}”</p>
                  <p className="hint mt-1">
                    {when} · Share a tip if you have one. If you tap “I don&apos;t know”, @{from?.handle ?? "they"} isn&apos;t told.
                  </p>
                </div>
                <QuestionForm itemId={item.id} variant="askAround" />
              </li>
            );
          }
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
