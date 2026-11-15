import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { platformOperator } from "@/lib/moderation/access";
import { LocalTime } from "@/components/LocalTime";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { GrantReviewerForm, RevokeReviewerButton } from "@/components/moderation/StaffAccess";

const Staff = z.object({ user_id: z.uuid(), email: z.string(), display_name: z.string().nullable(), enabled: z.boolean(), granted_at: z.string(), is_operator: z.boolean(), onboarded: z.boolean() });
export default async function StaffPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAgent(); if (!await platformOperator()) notFound();
  const page = z.coerce.number().int().min(0).max(400).catch(0).parse((await searchParams).page ?? 0);
  const db = await createClient();
  const [{ data, error }, { data: events }] = await Promise.all([
    db.rpc("platform_staff_directory", { p_offset: page * 25 }),
    db.from("platform_staff_events").select("id,actor_id,target_email,action,created_at").order("created_at", { ascending: false }).order("id", { ascending: false }).limit(30),
  ]);
  const staff = z.array(Staff).safeParse(data).data ?? [];
  const actorIds = [...new Set((events ?? []).map((event) => event.actor_id).filter((id): id is string => Boolean(id)))];
  const { data: actors } = actorIds.length ? await db.from("agents").select("owner_id,display_name").in("owner_id", actorIds) : { data: [] };
  return <div className="space-y-4"><RealtimeRefresh channel="platform-staff-management" tables={["platform_moderators", "platform_operators", "platform_staff_events"]} /><Link href="/settings" className="text-sm text-accent">‹ Settings</Link>
    <div><h1 className="text-xl font-semibold">Platform staff</h1><p className="mt-1 text-sm text-muted">Grant and remove access to review reported messages, groups and communities. Only AGENTME operators can manage staff.</p></div>
    <GrantReviewerForm />
    <section className="card space-y-3" aria-label="Platform reviewers"><h2 className="font-semibold">Reviewers</h2><p className="text-xs text-muted">Reviewer access grants report review, without staff management or unrestricted access to private chats.</p>
      {error ? <p role="alert" className="text-sm text-danger">Couldn&apos;t load reviewers. Refresh and try again.</p> : staff.length ? <ul className="divide-y divide-border">{staff.slice(0, 25).map((person) => <li key={person.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid="platform-staff-member">
        <div className="min-w-0"><p className="break-words font-medium">{person.display_name ?? "New account"}</p><p className="break-all text-sm text-muted">{person.email}</p><p className={`text-xs ${person.enabled ? "text-accent" : "text-muted"}`}>{person.enabled ? "Access enabled" : "Access removed"}{!person.onboarded && " · Needs to complete onboarding"}</p>{person.enabled && <p className="text-xs text-muted">Granted <LocalTime iso={person.granted_at} /></p>}</div>
        {person.is_operator ? <span className="text-xs text-muted">Protected operator</span> : person.enabled ? <RevokeReviewerButton id={person.user_id} email={person.email} /> : <span className="text-xs text-muted">Use Add a reviewer to restore access</span>}
      </li>)}</ul> : <p className="text-sm text-muted">No reviewers added yet.</p>}
      <div className="flex gap-3 text-sm">{page > 0 && <Link className="text-accent underline" href={`/moderation/staff?page=${page - 1}`}>Previous reviewers</Link>}{staff.length > 25 && <Link className="text-accent underline" href={`/moderation/staff?page=${page + 1}`}>More reviewers</Link>}</div>
    </section>
    {(events?.length ?? 0) > 0 && <section className="card space-y-3" aria-label="Staff access history"><h2 className="font-semibold">Recent access changes</h2>{events!.map((event) => <div key={event.id} className="border-t border-border pt-2 text-sm"><p className="break-all">Access {event.action === "grant" ? "granted to" : "removed for"} <b>{event.target_email}</b></p><p className="text-xs text-muted">{actors?.find((actor) => actor.owner_id === event.actor_id)?.display_name ?? "Former operator"} · <LocalTime iso={event.created_at} /></p></div>)}</section>}
  </div>;
}
