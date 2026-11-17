import { Avatar } from "@/components/Avatar";
import Link from "next/link";
import { createHash } from "node:crypto";
import { notFound } from "next/navigation";
import { adminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/auth";
import { BusinessInvitationForm } from "@/components/business/StaffForms";

export default async function StaffInvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params; if (!/^[A-Za-z0-9_-]{43}$/.test(token)) notFound();
  const db = adminClient(); const { data: invitation } = await db.from("business_staff_invites").select("id,business_agent_id,role,status,expires_at").eq("token_hash", createHash("sha256").update(token).digest("hex")).maybeSingle();
  if (!invitation) notFound(); const { data: business } = await db.from("agents").select("display_name,avatar").eq("id", invitation.business_agent_id).single(); if (!business) notFound();
  const user = await getUser(); const next = encodeURIComponent(`/staff-invite/${token}`);
  const member = user ? (await db.from("business_managers").select("role").eq("business_agent_id", invitation.business_agent_id).eq("user_id", user.actorId ?? user.id).maybeSingle()).data : null;
  return <main className="mx-auto max-w-lg space-y-5 px-4 py-10">
    <h1 className="text-xl font-semibold"><Avatar value={business.avatar} /> Join {business.display_name}&apos;s team</h1>
    <p className="text-sm">You&apos;re invited as <b className="capitalize">{invitation.role}</b>. Your personal account and chats stay separate.</p>
    {member ? <p role="status" className="card text-sm">Your invitation is accepted. Choose the business from your account menu.</p>
      : invitation.status !== "pending" || Date.parse(invitation.expires_at) <= new Date().getTime() ? <p role="status" className="card text-sm">This invitation has expired or is no longer available. Ask the business for a new invitation.</p>
      : !user ? <div className="space-y-3"><p className="hint">Log in to the personal account invited to this business.</p><Link className="btn-primary" href={`/login?next=${next}`}>Log in</Link></div>
      : user.businessRole ? <p className="card text-sm">Switch to your personal account first, then return to this invitation.</p>
      : <BusinessInvitationForm id={invitation.id} />}
    <Link href="/chats" className="text-sm text-accent underline">Go to AGENTME</Link>
  </main>;
}
