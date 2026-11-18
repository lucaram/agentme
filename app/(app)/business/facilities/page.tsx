import Link from "next/link";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { FacilitiesEditor } from "../FacilitiesEditor";
import { PriceSources } from "../PriceSources";
import { offeringsPage } from "../offerings-page";

export default async function FacilitiesPage() {
  const { agentId, sources, facilities } = await offeringsPage();
  return (
    <div className="space-y-4">
      {/* Reading happens in the background: the page updates when it starts and ends. */}
      <RealtimeRefresh channel={`facilities-${agentId}`} tables={["business_sources"]} />
      <div>
        <Link href="/business#prices-facilities" className="text-sm text-accent hover:underline" data-testid="back-to-knows">‹ What your agent knows</Link>
        <h1 className="mt-1 text-lg font-semibold">Facilities</h1>
        <p className="text-xs text-muted">Found in your website and documents, or added by you. Add, edit or remove any of them.</p>
      </div>
      <PriceSources sources={sources} empty={!facilities.length} variant="facilities" />
      <FacilitiesEditor facilities={facilities} />
    </div>
  );
}
