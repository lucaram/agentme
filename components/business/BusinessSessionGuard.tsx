"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase/client";

export function BusinessSessionGuard({ actorId, userId, role }: { actorId: string; userId: string; role: string | null }) {
  const router = useRouter();
  useEffect(() => {
    let stopped = false; let loading = false; const client = browserClient();
    const check = async (force = false) => {
      if (stopped || loading) return; loading = true;
      try { const response = await fetch("/api/business/session", { cache: "no-store" }); if (stopped) return; if (response.status === 401) { router.replace("/login?reason=business-access"); return; } if (!response.ok) return; const data = await response.json(); if (force || data.id !== userId || data.role !== role) router.refresh(); } catch {} finally { loading = false; }
    };
    const channel = client.channel(`business-membership-${actorId}`).on("postgres_changes", { event: "*", schema: "public", table: "business_membership_versions", filter: `user_id=eq.${actorId}` }, () => { void check(true); });
    void client.auth.getSession().then(async ({ data }) => { if (stopped || !data.session) return; await client.realtime.setAuth(data.session.access_token); if (!stopped) channel.subscribe(); });
    const interval = setInterval(() => { if (role) void check(); }, 10_000);
    return () => { stopped = true; clearInterval(interval); void client.removeChannel(channel); };
  }, [actorId, userId, role, router]);
  return null;
}
