import Link from "next/link";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { FacilitiesEditor } from "../FacilitiesEditor";
import { offeringsPage } from "../offerings-page";

export default async function FacilitiesPage() {
  const { agentId, problems, facilities, hasSources } = await offeringsPage();
  return (
    <div className="space-y-4">
      {/* A read started with "Look again" finishes in the background: show it when it does. */}
      <RealtimeRefresh channel={`facilities-${agentId}`} tables={["business_sources"]} />
      <div>
        <Link href="/business#prices-facilities" className="text-sm text-accent hover:underline" data-testid="back-to-knows">‹ What your agent knows</Link>
        <h1 className="mt-1 text-lg font-semibold">Facilities</h1>
        <p className="text-xs text-muted">Found in your website and documents, or added by you. Add, edit or remove any of them.</p>
      </div>
      {problems.map((p) => (
        <p key={p.label} className="rounded-lg border border-danger/40 px-3 py-2 text-xs text-danger" data-testid="offerings-problem">
          ⚠️ {p.label}: {p.error} What was read before stays. Tap “Look again” to try again.
        </p>
      ))}
      <FacilitiesEditor facilities={facilities} hasSources={hasSources} />
    </div>
  );
}
