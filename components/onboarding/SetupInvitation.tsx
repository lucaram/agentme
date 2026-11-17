"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { dismissSetupAction } from "@/app/onboarding/setup-actions";

/** A one-off invitation, not a task or a notification. Existing accounts don't receive it. */
export function SetupInvitation({ business, websiteSaved }: { business: boolean; websiteSaved: boolean }) {
  const path = usePathname(); const router = useRouter();
  const [hidden, setHidden] = useState(false); const [error, setError] = useState(""); const [pending, start] = useTransition();
  const destination = business ? websiteSaved ? "/business/setup" : "/business" : "/settings/about";
  const atSetup = business ? path.startsWith("/business") : path.startsWith("/settings/about");
  useEffect(() => {
    if (!atSetup) return;
    let live = true;
    // Reaching the settings directly also completes this invitation.
    void dismissSetupAction().then((result) => { if (live && !result.error) setHidden(true); }).catch(() => {});
    return () => { live = false; };
  }, [atSetup]);
  if (hidden || atSetup) return null;
  const finish = (navigate: boolean) => start(async () => {
    try {
      const result = await dismissSetupAction();
      if (result.error) { setError(result.error); return; }
      setHidden(true); if (navigate) router.push(destination);
    } catch { setError("Couldn't save that choice. Please try again."); }
  });
  return <aside className="mx-4 mt-3 space-y-2 rounded-xl border border-border bg-surface p-3 text-sm" aria-label="Optional account setup" data-testid="setup-invitation">
    <p className="font-medium">{business ? websiteSaved ? "Your website is saved" : "Introduce your business" : "Personalise your agent"}</p>
    <p className="text-xs text-muted">{business ? websiteSaved ? "Review your website information before publishing, now or later in My Business → Website & documents." : "Add information whenever you're ready in My Business." : "Add preferences and saved tips in Settings → What your agent knows about you. You control what is shared."}</p>
    <div className="flex flex-wrap gap-2"><button type="button" className="btn-ghost text-sm" disabled={pending} onClick={() => finish(true)}>{business && websiteSaved ? "Review now" : "Add details"}</button><button type="button" className="px-2 text-xs text-muted hover:underline" disabled={pending} onClick={() => finish(false)}>{business && websiteSaved ? "Later in My Business" : "Not now"}</button></div>
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </aside>;
}
