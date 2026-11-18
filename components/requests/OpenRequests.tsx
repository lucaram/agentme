import { Avatar } from "@/components/Avatar";
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
import type { ReactNode } from "react";
import { requireAgent } from "@/lib/auth";
import { BusinessInvitationForm, BusinessAnswerReview } from "@/components/business/StaffForms";
import { QuestionAssignment } from "@/components/business/QuestionAssignment";
import { adminClient } from "@/lib/supabase/admin";

type Kind = "info_request" | "question" | "introduction" | "group_invite" | "business_invitation" | "business_answer_review";

/**
 * One colour per kind of decision: approving something, answering someone, accepting an invitation.
 * Fixed colours (not the identity's accent, which may be any of them), so the kinds never look alike.
 */
const TONES = {
  approve: { bar: "border-l-amber-500", label: "text-amber-700 dark:text-amber-400" },
  answer: { bar: "border-l-sky-500", label: "text-sky-700 dark:text-sky-400" },
  invite: { bar: "border-l-emerald-500", label: "text-emerald-700 dark:text-emerald-400" },
} as const;

/**
 * One request: a coloured bar down its left edge, then what kind it is, from whom and when,
 * and what you're asked to do; then its details and buttons.
 */
function RequestCard({ tone, icon, kind, from, when, action, testId, children }: { tone: keyof typeof TONES; icon: string; kind: string; from?: ReactNode; when: ReactNode; action: ReactNode; testId: string; children: ReactNode }) {
  return (
    <li className={`card space-y-3 border-l-4 ${TONES[tone].bar}`} data-testid={testId}>
      <div>
        <p className={`text-[11px] font-semibold uppercase tracking-wide ${TONES[tone].label}`} data-testid="request-kind">
          <span aria-hidden>{icon}</span> {kind}
          {from && <span className="font-normal normal-case tracking-normal text-muted"> · {from}</span>}
          <span className="font-normal normal-case tracking-normal text-muted"> · {when}</span>
        </p>
        <p className="mt-0.5 font-semibold">{action}</p>
      </div>
      {children}
    </li>
  );
}

/**
 * Things only you can decide, as cards with buttons: an agent asking for
 * information you didn't set to share, a contact's question, an introduction,
 * a group invite. Shown pinned at the top of My Agent ("Needs your answer"),
 * and the relevant ones in Contacts and Groups. Renders nothing when empty.
 */
export async function OpenRequests({ title, kinds, hint, excludeIds = [] }: { title: string; kinds?: Kind[]; hint?: string; excludeIds?: string[] }) {
  const supabase = await createClient();
  const { user, agent } = await requireAgent();
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
  const businessQuestions = items.filter((item) => { const p = inboxPayloadOf(item); return p.kind === "question" && p.business; });
  const [{ data: claims }, { data: members }] = agent.type === "business" && businessQuestions.length ? await Promise.all([
    supabase.from("business_question_claims").select("inbox_id,assigned_to,assigned_name,claimed_at,manager_assigned").in("inbox_id", businessQuestions.map((item) => item.id)),
    adminClient().from("business_managers").select("user_id,role,require_assignment,require_publication_approval,supervisor_id").eq("business_agent_id", agent.id),
  ]) : [{ data: [] }, { data: [] }];
  const memberIds = (members ?? []).map((member) => member.user_id);
  const { data: people } = memberIds.length ? await adminClient().from("agents").select("owner_id,display_name").in("owner_id", memberIds) : { data: [] };
  const assignments = (members ?? []).flatMap((member) => { const person = people?.find((person) => person.owner_id === member.user_id); return person ? [{ id: member.user_id, name: person.display_name, role: member.role, supervisorId: member.supervisor_id }] : []; });
  const actor = user.actorId ?? user.id;
  const myControls = members?.find((member) => member.user_id === actor);
  const assignmentRequired = user.businessRole === "staff" && myControls?.require_assignment === true;

  return (
    <section className="rounded-2xl border-2 border-accent bg-accent-soft/40 p-3" aria-label={title} data-testid="open-requests">
      <StaffQuestionRead ids={items.filter((item) => { const payload = inboxPayloadOf(item); return payload.kind === "question" && payload.business; }).map((item) => item.id)} />
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        🔔 {title} <span className="rounded-full bg-accent px-2 text-xs text-white dark:text-black">{items.length}</span>
      </h2>
      {hint && <p className="mb-2 text-xs text-muted">{hint}</p>}
      <ul className="space-y-5">
        {items.map((item) => {
          const from = item.from_agent ? byId.get(item.from_agent) : undefined;
          const who = from ? <><Avatar value={from.avatar} /> @{from.handle}</> : "Someone";
          const when = <LocalTime iso={item.created_at} />;

          if (item.kind === "business_invitation") {
            const p = item.payload as { invite_id?: string; business_name?: string; role?: string };
            return <RequestCard key={item.id} tone="invite" icon="👥" kind="Team invitation" from={p.business_name} when={when} action={<>Join {p.business_name}&apos;s team as {p.role}?</>} testId="staff-invitation"><p className="hint">Uses your own login. Personal chats stay separate.</p>{p.invite_id && <BusinessInvitationForm id={p.invite_id} />}</RequestCard>;
          }
          if (item.kind === "business_answer_review") {
            const p = item.payload as { draft_id?: string; author?: string; question?: string; answer?: string };
            return <RequestCard key={item.id} tone="approve" icon="✅" kind="Answer to approve" from={p.author} when={when} action={<>Approve or decline {p.author ?? "a team member"}&apos;s answer</>} testId="business-answer-review">{p.draft_id && <BusinessAnswerReview id={p.draft_id} question={p.question ?? ""} answer={p.answer ?? ""} canApprove={user.businessRole === "owner" || user.businessRole === "manager"} />}</RequestCard>;
          }
          if (item.kind === "group_invite") {
            const invite = previewsById.get(item.id)!;
            return (
              <RequestCard key={item.id} tone="invite" icon="👥" kind="Group invitation" from={who} when={when} action={<>{from?.display_name ?? "Someone"} invited you to “{invite.title ?? "a group"}”</>} testId="inbox-item">
                {invite.description && <p className="text-sm text-muted">{invite.description}</p>}
                <p className="hint">{invite.members} {invite.members === 1 ? "member" : "members"} · {invite.earlierHistory ? "Earlier messages will be shared." : "Messages from joining, plus current shared plans and polls."}</p>
                <p className="hint">Expires <LocalTime iso={invite.expires} /> · Joining does not RSVP to an event.</p>
                <GroupInviteForm itemId={item.id} />
              </RequestCard>
            );
          }

          if (item.kind === "introduction") {
            const intro = item.payload as unknown as IntroductionPayload;
            const other = byId.get(intro.other_agent);
            return (
              <RequestCard key={item.id} tone="invite" icon="🤝" kind="Introduction" from={who} when={when} action={<>{from?.display_name ?? "A friend"} wants to introduce you to <Avatar value={other?.avatar} /> {other?.display_name ?? "someone"} <span className="font-normal text-muted">@{other?.handle}</span></>} testId="inbox-item">
                {intro.note && <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm">“{intro.note}”</p>}
                <IntroductionForm itemId={item.id} name={other?.display_name ?? "them"} />
              </RequestCard>
            );
          }

          const payload = inboxPayloadOf(item);
          if (payload.kind === "question" && payload.business) {
            return (
              <RequestCard key={item.id} tone="answer" icon="❓" kind="Customer question" from={who} when={when} action={<>Answer {from?.display_name ?? "the customer"}&apos;s question</>} testId="inbox-item">
                <div>
                  <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm" data-staff-question={item.id}>“{payload.question}”</p>
                  <p className="hint mt-1">Your agent didn&apos;t find this in your business info. Your answer goes back to them, from the team.</p>
                </div>
                <QuestionAssignment id={item.id} actor={actor} claim={claims?.find((claim) => claim.inbox_id === item.id)} role={user.businessRole} members={assignments} assignmentRequired={assignmentRequired} />
                <QuestionForm itemId={item.id} variant="business" faqEligible={payload.faq_eligible === true} staff={user.businessRole === "staff"} approvalRequired={myControls?.require_publication_approval !== false} disabled={Boolean(claims?.find((claim) => claim.inbox_id === item.id && claim.assigned_to && claim.assigned_to !== actor)) || Boolean(assignmentRequired && !claims?.some((claim) => claim.inbox_id === item.id && claim.assigned_to === actor && claim.manager_assigned))} />
              </RequestCard>
            );
          }
          if (payload.kind === "question" && payload.ask_around) {
            return (
              <RequestCard key={item.id} tone="answer" icon="🔎" kind="Asking around" from={who} when={when} action={<>Share a tip with {from?.display_name ?? "them"}?</>} testId="inbox-item">
                <div>
                  <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm">“{payload.question}”</p>
                  <p className="hint mt-1">Share a tip if you have one. If you tap “I don&apos;t know”, @{from?.handle ?? "they"} isn&apos;t told.</p>
                </div>
                <QuestionForm itemId={item.id} variant="askAround" />
              </RequestCard>
            );
          }
          if (payload.kind === "question") {
            return (
              <RequestCard key={item.id} tone="answer" icon="❓" kind="Question for you" from={who} when={when} action={<>Answer {from?.display_name ?? "their"}{from ? "'s" : ""} question</>} testId="inbox-item">
                <div>
                  <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm">“{payload.question}”</p>
                  <p className="hint mt-1">Only @{from?.handle ?? "they"} will see your answer.</p>
                </div>
                <QuestionForm itemId={item.id} />
              </RequestCard>
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
            <RequestCard key={item.id} tone="answer" icon="📅" kind="Plan details" from={who} when={when} action={<>Share your {fields.map((f) => f.label.toLowerCase()).join(" and ")} for {payload.event}?</>} testId="inbox-item">
              <div>
                <p className="text-sm">
                  <b>{who}&apos;s agent</b> is organising <b>{payload.event}</b> ({payload.window}).
                </p>
                <p className="hint">Your agent didn&apos;t answer because some of this isn&apos;t set to be shared.</p>
              </div>
              <InboxItemForm itemId={item.id} fields={fields} />
            </RequestCard>
          );
        })}
      </ul>
    </section>
  );
}
